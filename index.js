const net = require('net');
require('dotenv').config(); // Load environment variables from .env file

// Configuration from environment variables
const LISTEN_PORT = process.env.SOCKS5_PORT || 1080;
const USERNAME = process.env.SOCKS5_USERNAME || 'admin';
const PASSWORD = process.env.SOCKS5_PASSWORD || 'password';

// Create TCP server
const server = net.createServer((clientSocket) => {
    const clientAddress = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    console.log(`[+] Client connected from: ${clientAddress}`);
    
    // Log the connection attempt
    logConnection(clientSocket, 'INIT', '0.0.0.0', 0);
    
    handleSocks5Connection(clientSocket).catch((err) => {
        console.error(`[-] Error handling connection from ${clientAddress}:`, err.message);
        clientSocket.end();
    });
});

// Start server
server.listen(LISTEN_PORT, () => {
    console.log(`[+] SOCKS5 proxy server listening on port ${LISTEN_PORT}`);
});

// Handle SOCKS5 protocol
async function handleSocks5Connection(clientSocket) {
    const clientAddress = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    
    try {
        // --- PHASE 1: Initial Handshake ---
        const handshake = await readPacket(clientSocket);
        
        if (handshake[0] !== 0x05) {
            throw new Error('Unsupported SOCKS version');
        }
        
        const nmethods = handshake[1];
        const methods = handshake.slice(2, 2 + nmethods);
        const acceptsUserPass = methods.includes(0x02);
        
        let response;
        if (acceptsUserPass) {
            response = Buffer.from([0x05, 0x02]);
        } else {
            response = Buffer.from([0x05, 0xFF]);
            clientSocket.write(response);
            throw new Error('Client does not support username/password authentication');
        }
        
        clientSocket.write(response);
        
        // --- PHASE 2: Authentication ---
        const authPacket = await readPacket(clientSocket);
        
        if (authPacket[0] !== 0x01) {
            throw new Error('Invalid authentication version');
        }
        
        const ulen = authPacket[1];
        const username = authPacket.slice(2, 2 + ulen).toString('utf8');
        const plen = authPacket[2 + ulen];
        const password = authPacket.slice(3 + ulen, 3 + ulen + plen).toString('utf8');
        
        console.log(`[ ] Authentication attempt from ${clientAddress}: ${username}`);
        
        let authResponse;
        if (username === USERNAME && password === PASSWORD) {
            authResponse = Buffer.from([0x01, 0x00]);
            console.log(`[+] Authentication successful for ${username} from ${clientAddress}`);
        } else {
            authResponse = Buffer.from([0x01, 0x01]);
            console.log(`[-] Authentication failed for ${username} from ${clientAddress}`);
            clientSocket.write(authResponse);
            throw new Error('Authentication failed');
        }
        
        clientSocket.write(authResponse);
        
        // --- PHASE 3: Connection Request ---
        const requestPacket = await readPacket(clientSocket);
        
        if (requestPacket[0] !== 0x05 || requestPacket[1] !== 0x01 || requestPacket[2] !== 0x00) {
            throw new Error('Unsupported command or reserved field not zero');
        }
        
        let host, port;
        const addressType = requestPacket[3];
        
        switch (addressType) {
            case 0x01: // IPv4
                host = Array.from(requestPacket.slice(4, 8)).join('.');
                port = requestPacket.readUInt16BE(8);
                break;
            case 0x03: // Domain name
                const domainLength = requestPacket[4];
                host = requestPacket.slice(5, 5 + domainLength).toString('utf8');
                port = requestPacket.readUInt16BE(5 + domainLength);
                break;
            case 0x04: // IPv6 (not fully implemented, but basic support)
                const ipv6 = requestPacket.slice(4, 20);
                host = Array.from(ipv6).map(b => b.toString(16).padStart(2, '0')).join(':');
                port = requestPacket.readUInt16BE(20);
                break;
            default:
                throw new Error('Unsupported address type');
        }
        
        console.log(`[ ] Connection request to ${host}:${port} from ${clientAddress}`);
        
        // Log the connection
        logConnection(clientSocket, 'CONNECT', host, port);
        
        // --- PHASE 4: Establish connection to target ---
        const targetSocket = net.createConnection({ host, port }, () => {
            console.log(`[+] Connected to target: ${host}:${port}`);
            
            // Send success response to client
            let response;
            if (addressType === 0x01) {
                response = Buffer.alloc(10);
                response[0] = 0x05; // VER
                response[1] = 0x00; // REP (success)
                response[2] = 0x00; // RSV
                response[3] = 0x01; // ATYP (IPv4)
                targetSocket.address().address.split('.').forEach((octet, i) => {
                    response[4 + i] = parseInt(octet);
                });
                response.writeUInt16BE(targetSocket.address().port, 8);
            } else {
                // For domain and IPv6, we'll send back the same address type
                const addrBuf = Buffer.from(host);
                response = Buffer.alloc(7 + addrBuf.length);
                response[0] = 0x05; // VER
                response[1] = 0x00; // REP (success)
                response[2] = 0x00; // RSV
                response[3] = addressType; // ATYP
                if (addressType === 0x03) {
                    response[4] = addrBuf.length;
                    addrBuf.copy(response, 5);
                    response.writeUInt16BE(port, 5 + addrBuf.length);
                }
            }
            
            clientSocket.write(response);
            
            // --- PHASE 5: Data tunneling ---
            clientSocket.pipe(targetSocket);
            targetSocket.pipe(clientSocket);
        });
        
        targetSocket.on('error', (err) => {
            console.error(`[-] Target connection error (${host}:${port}):`, err.message);
            
            // Send failure response to client
            const response = Buffer.from([
                0x05, 0x04, // Host unreachable
                0x00, 0x01, // IPv4
                0x00, 0x00, 0x00, 0x00, // 0.0.0.0
                0x00, 0x00 // port 0
            ]);
            
            clientSocket.write(response);
            clientSocket.end();
        });
        
        targetSocket.on('close', () => {
            console.log(`[ ] Target connection closed: ${host}:${port}`);
            clientSocket.end();
        });
        
        clientSocket.on('close', () => {
            console.log(`[ ] Client disconnected: ${clientAddress}`);
            targetSocket.end();
        });
        
    } catch (err) {
        throw err;
    }
}

// Helper function to read data from socket
function readPacket(socket) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for data'));
        }, 10000);
        
        socket.once('data', (data) => {
            clearTimeout(timeout);
            resolve(data);
        });
        
        socket.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        
        socket.once('close', () => {
            clearTimeout(timeout);
            reject(new Error('Socket closed before data received'));
        });
    });
}

// Log connection details
function logConnection(clientSocket, action, destHost, destPort) {
    const timestamp = new Date().toISOString();
    const sourceIp = clientSocket.remoteAddress;
    
    console.log(`[LOG] ${timestamp} | ${action} | Source: ${sourceIp} | Destination: ${destHost}:${destPort}`);
}

// Handle server errors
server.on('error', (err) => {
    console.error('[-] Server error:', err.message);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[ ] Shutting down server...');
    server.close(() => {
        console.log('[+] Server stopped');
        process.exit(0);
    });
});