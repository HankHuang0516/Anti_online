const io = require('socket.io-client');

const socket = io('http://localhost:3001');

socket.on('connect', () => {
    console.log('Connected to server for test');

    // Enable macro mode just in case
    socket.emit('MACRO_MODE', true);

    setTimeout(() => {
        // Send a command that might trigger a permission request
        // "dir" is a common safe command that agents usually ask permission for
        console.log('Sending command: dir');
        socket.emit('INPUT_TEXT', 'dir');

        // Press Enter to submit
        setTimeout(() => {
            socket.emit('PRESS_KEY', 'ENTER');
            console.log('Sent ENTER');

            // Disconnect after a short delay
            setTimeout(() => {
                socket.close();
            }, 1000);
        }, 500);
    }, 1000);
});
