import sys
import json
import time
import base64
import threading
import io
import os
import mss
import pyautogui
from PIL import Image

# Try to import OpenCV and NumPy for image matching
try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False
    sys.stderr.write("Warning: OpenCV/NumPy not found. Image matching features (Auto Accept, Retry) will be disabled.\n")

# Configuration
FPS = 15
JPEG_QUALITY = 50
TARGET_WIDTH = 1024

# Globals for Offset & State
OFFSET_X = 0
OFFSET_Y = 0
SCALE_X = 1.0
SCALE_Y = 1.0
CURRENT_MONITOR_INDEX = 1
MONITOR_CHANGE_PENDING = False

# Auto Accept State
AUTO_ACCEPT_RUNNING = False
AUTO_ACCEPT_THREAD = None

# Force UTF-8 for stdin/stdout to handle Chinese characters correctly
if sys.platform == 'win32':
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')

# Helper: Find Template on Screen
def find_template(template_name, threshold=0.85):
    if not HAS_CV2:
        return None
        
    try:
        # Construct absolute path to assets
        base_path = os.path.dirname(os.path.abspath(__file__))
        template_path = os.path.join(base_path, 'assets', template_name)
        
        if not os.path.exists(template_path):
            sys.stderr.write(f"Template not found: {template_path}\n")
            return None

        # Load template
        template = cv2.imread(template_path)
        if template is None:
            return None
            
        with mss.mss() as sct:
            # Capture current monitor
            monitor = sct.monitors[CURRENT_MONITOR_INDEX] if CURRENT_MONITOR_INDEX < len(sct.monitors) else sct.monitors[1]
            sct_img = sct.grab(monitor)
            screen_img = np.array(sct_img)
            
            # Convert BGRA (mss) to BGR (cv2)
            screen_img = cv2.cvtColor(screen_img, cv2.COLOR_BGRA2BGR)
            
            # Match
            result = cv2.matchTemplate(screen_img, template, cv2.TM_CCOEFF_NORMED)
            min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
            
            if max_val >= threshold:
                # Calculate center
                h, w = template.shape[:2]
                center_x = max_loc[0] + w // 2
                center_y = max_loc[1] + h // 2
                
                # Apply monitor offset to get absolute coordinates
                abs_x = center_x + monitor['left']
                abs_y = center_y + monitor['top']
                
                return (abs_x, abs_y, max_val)
                
    except Exception as e:
        sys.stderr.write(f"Template match error: {e}\n")
        
    return None

# Auto Accept Loop
def auto_accept_loop():
    global AUTO_ACCEPT_RUNNING
    sys.stderr.write("Auto Accept Loop Started\n")
    
    while AUTO_ACCEPT_RUNNING:
        try:
            # Check for 'accept_exact_bgr.png' (Accept All)
            match = find_template('accept_exact_bgr.png', threshold=0.92)
            if match:
                x, y, score = match
                sys.stderr.write(f"Auto Accept found at ({x}, {y}) score={score:.2f}\n")
                pyautogui.click(x=x, y=y)
                time.sleep(1.0) # Wait to avoid double clicks
            
            # Sleep 3 seconds
            for _ in range(30): 
                if not AUTO_ACCEPT_RUNNING: break
                time.sleep(0.1)
                
        except Exception as e:
            sys.stderr.write(f"Auto Accept Error: {e}\n")
            time.sleep(3)

    sys.stderr.write("Auto Accept Loop Stopped\n")

def capture_loop():
    global OFFSET_X, OFFSET_Y, SCALE_X, SCALE_Y, CURRENT_MONITOR_INDEX, MONITOR_CHANGE_PENDING
    
    # Outer Loop: Handles Re-initialization of MSS
    while True:
        try:
            with mss.mss() as sct:
                # Validate Index
                if CURRENT_MONITOR_INDEX >= len(sct.monitors):
                    CURRENT_MONITOR_INDEX = 1 if len(sct.monitors) > 1 else 0
                
                monitor = sct.monitors[CURRENT_MONITOR_INDEX]
                OFFSET_X = monitor['left']
                OFFSET_Y = monitor['top']
                
                sys.stderr.write(f"Capturing Monitor {CURRENT_MONITOR_INDEX}: {monitor}\n")
                sys.stderr.flush()
                
                # Inner Loop: Capture frames
                while not MONITOR_CHANGE_PENDING:
                    start_time = time.time()
                    
                    try:
                        # Capture
                        sct_img = sct.grab(monitor)
                        
                        # Convert to PIL Image
                        img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                        
                        # Resize & Calculate Scale
                        width, height = img.size
                        
                        if width > TARGET_WIDTH:
                            new_height = int(height * (TARGET_WIDTH / width))
                            img = img.resize((TARGET_WIDTH, new_height), Image.Resampling.LANCZOS)
                            
                            SCALE_X = width / TARGET_WIDTH
                            SCALE_Y = height / new_height
                        else:
                            SCALE_X = 1.0
                            SCALE_Y = 1.0

                        # Save to Bytes
                        buffer = io.BytesIO()
                        img.save(buffer, format="JPEG", quality=JPEG_QUALITY)
                        buffer.seek(0)
                        
                        # Base64 Encode
                        b64_data = base64.b64encode(buffer.read()).decode('utf-8')
                        
                        # Print to stdout
                        print(json.dumps({"type": "screen", "data": b64_data}))
                        sys.stdout.flush()

                    except Exception as e:
                        # sys.stderr.write(f"Capture error: {e}\n")
                        pass

                    # FPS Limit
                    elapsed = time.time() - start_time
                    sleep_time = max(0, (1.0 / FPS) - elapsed)
                    time.sleep(sleep_time)

                # Handle Switch (Outside inner loop, inside outer loop)
                if MONITOR_CHANGE_PENDING:
                    num_monitors = len(sct.monitors)
                    if num_monitors > 1:
                        # Cycle index
                        CURRENT_MONITOR_INDEX = (CURRENT_MONITOR_INDEX % (num_monitors - 1)) + 1
                        
                        # Log switch
                        new_monitor = sct.monitors[CURRENT_MONITOR_INDEX]
                        msg = f"Switching to Monitor {CURRENT_MONITOR_INDEX}: {new_monitor}"
                        sys.stderr.write(msg + "\n")
                        print(json.dumps({"type": "log", "message": msg}))
                        sys.stdout.flush()
                    
                    MONITOR_CHANGE_PENDING = False
                    # Loop continues -> Re-enters 'with mss()', re-initializing it.

        except Exception as e:
            sys.stderr.write(f"Critical Sct Error: {e}\n")
            time.sleep(1)

def input_loop():
    """Reads commands from stdin"""
    for line in sys.stdin:
        try:
            line = line.strip()
            if not line:
                continue
            cmd = json.loads(line)
            handle_command(cmd)
        except Exception:
            pass

def handle_command(cmd):
    global OFFSET_X, OFFSET_Y, SCALE_X, SCALE_Y, MONITOR_CHANGE_PENDING, AUTO_ACCEPT_RUNNING, AUTO_ACCEPT_THREAD
    
    ctype = cmd.get('type')
    # sys.stderr.write(f"Agent processing command: {ctype}\n") # DEBUG LOG - Keep stderr for local debug
    
    # Helper to send log
    def send_log(msg):
        print(json.dumps({"type": "log", "message": msg}))
        sys.stdout.flush()

    if ctype == 'SWITCH_MONITOR':
        MONITOR_CHANGE_PENDING = True
        send_log("Switching Monitor...")

    elif ctype == 'SET_MONITOR':
        idx = cmd.get('index')
        if idx is not None:
             CURRENT_MONITOR_INDEX = int(idx)
             MONITOR_CHANGE_PENDING = True
             send_log(f"Setting Monitor to {idx}")
        
    elif ctype == 'MOUSE_CLICK':
        x = cmd.get('x')
        y = cmd.get('y')
        if x is not None and y is not None:
            # Apply Scaling + Offset
            real_x = int(x * SCALE_X) + OFFSET_X
            real_y = int(y * SCALE_Y) + OFFSET_Y
            pyautogui.click(x=real_x, y=real_y)
            send_log(f"Clicked at ({x}, {y})")
            
    elif ctype == 'INPUT_TEXT':
        text = cmd.get('text')
        # App.jsx sends dialogX/dialogY for input text location
        x = cmd.get('dialogX')
        y = cmd.get('dialogY')
        
        if x is not None and y is not None:
             # Click to focus
             real_x = int(x * SCALE_X) + OFFSET_X
             real_y = int(y * SCALE_Y) + OFFSET_Y
             pyautogui.click(x=real_x, y=real_y)
             time.sleep(0.5) # Wait for UI focus

        if text:
            copy_to_clipboard(text)
            time.sleep(0.1) # Wait for clipboard
            pyautogui.hotkey('ctrl', 'v')
            time.sleep(0.1)
            pyautogui.press('enter')
            send_log(f"Typed text: {text}")
            
    elif ctype == 'KEY_TAP':
        key = cmd.get('key')
        if key:
            pyautogui.press(key)
            send_log(f"Pressed key: {key}")

    elif ctype == 'TIMED_LOOP_START' or ctype == 'MACRO_LOOP_START':
        # One-shot execution triggering
        x = cmd.get('x')
        y = cmd.get('y')
        text = cmd.get('text')
        
        send_log("Starting Timed/Macro Loop Sequence...")

        if x is not None and y is not None:
             real_x = int(x * SCALE_X) + OFFSET_X
             real_y = int(y * SCALE_Y) + OFFSET_Y
             pyautogui.click(x=real_x, y=real_y)
             time.sleep(0.5)

        if text:
            copy_to_clipboard(text)
            time.sleep(0.1)
            pyautogui.hotkey('ctrl', 'v')
            time.sleep(0.1)
            pyautogui.press('enter')
            send_log(f"Loop pasted text: {text}")
            
        # Always press Alt+Enter as per original requirement
        time.sleep(0.5)
        pyautogui.hotkey('alt', 'enter')
        send_log("Pressed Alt+Enter")

        # Check for Retry Button
        time.sleep(1.0)
        match = find_template('retry_button.png', threshold=0.85)
        if match:
            rx, ry, score = match
            sys.stderr.write(f"Retry button found at ({rx}, {ry})\n")
            pyautogui.click(x=rx, y=ry)
            send_log("Retry button found and clicked.")
        else:
            send_log("Retry button not found (Success?).")
    
    elif ctype == 'AUTO_ACCEPT_START':
        if not AUTO_ACCEPT_RUNNING:
            AUTO_ACCEPT_RUNNING = True
            AUTO_ACCEPT_THREAD = threading.Thread(target=auto_accept_loop, daemon=True)
            AUTO_ACCEPT_THREAD.start()
            send_log("Auto Accept Started")
            
    elif ctype == 'AUTO_ACCEPT_STOP':
        AUTO_ACCEPT_RUNNING = False
        send_log("Auto Accept Stopped")
        
    elif ctype == 'RESTART_TERMINAL':
        # logic: click -> wait 1s -> ctrl+c -> wait 2s -> paste command -> wait 1s -> enter
        x = cmd.get('x')
        y = cmd.get('y')
        command = cmd.get('command')
        
        if x is not None and y is not None and command:
            send_log(f"Restarting Terminal with command: {command}")
            real_x = int(x * SCALE_X) + OFFSET_X
            real_y = int(y * SCALE_Y) + OFFSET_Y
            
            # 1. Click Terminal
            pyautogui.click(x=real_x, y=real_y)
            time.sleep(1.0)
            
            # 2. Ctrl+C
            pyautogui.hotkey('ctrl', 'c')
            time.sleep(2.0)
            
            # 3. Paste Command
            copy_to_clipboard(command)
            time.sleep(0.1)
            pyautogui.hotkey('ctrl', 'v')
            time.sleep(1.0)
            
            # 4. Enter
            pyautogui.press('enter')
            send_log("Terminal restart sequence completed.")

def copy_to_clipboard(text):
    """
    Copies text to clipboard using Windows ctypes to support Unicode (Chinese).
    Avoiding external dependencies like pyperclip if possible, or fallback.
    """
    try:
        import ctypes
        from ctypes import wintypes
        
        CF_UNICODETEXT = 13
        GMEM_MOVEABLE = 0x0002
        
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        
        # Define Argument types for 64-bit compatibility
        kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
        kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
        
        kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalLock.restype = ctypes.c_void_p
        
        kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
        kernel32.GlobalUnlock.restype = wintypes.BOOL
        
        user32.OpenClipboard.argtypes = [wintypes.HWND]
        user32.OpenClipboard.restype = wintypes.BOOL
        
        user32.EmptyClipboard.argtypes = []
        user32.EmptyClipboard.restype = wintypes.BOOL
        
        user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
        user32.SetClipboardData.restype = wintypes.HANDLE
        
        user32.CloseClipboard.argtypes = []
        user32.CloseClipboard.restype = wintypes.BOOL

        if not user32.OpenClipboard(None):
            return
        
        user32.EmptyClipboard()
        
        # Use 'replace' to safe handle surrogate errors
        data = text.encode('utf-16le', 'replace') + b'\x00\x00'
        
        hCd = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
        if not hCd:
            user32.CloseClipboard()
            return
            
        pchData = kernel32.GlobalLock(hCd)
        if not pchData:
            kernel32.GlobalFree(hCd)
            user32.CloseClipboard()
            return
        
        ctypes.memmove(pchData, data, len(data))
        
        kernel32.GlobalUnlock(hCd)
        user32.SetClipboardData(CF_UNICODETEXT, hCd)
        user32.CloseClipboard()
        
    except Exception as e:
        sys.stderr.write(f"Clipboard Error: {e}\n")

if __name__ == "__main__":
    t = threading.Thread(target=capture_loop, daemon=True)
    t.start()
    input_loop()
