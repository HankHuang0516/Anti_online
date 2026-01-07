Set WshShell = CreateObject("WScript.Shell")

' Hardcoded project path to ensure it works even when moved to Startup folder
ProjectDir = "c:\Hank\Other\project\anti_online"

' Explicit paths for logs
LogPath = ProjectDir & "\server.log"
UrlPath = ProjectDir & "\url.txt"

' 1. Start Server (Hidden)
' We navigate explicitly to the ProjectDir\server folder
WshShell.Run "cmd /c ""cd /d " & ProjectDir & "\server && npm start > " & LogPath & " 2>&1""", 0, False

' 2. Start LocalTunnel (Hidden)
' We navigate explicitly to the ProjectDir folder
WshShell.Run "cmd /c ""cd /d " & ProjectDir & " && npx -y localtunnel --port 3001 --subdomain anti-online-user > " & UrlPath & " 2>&1""", 0, False
