# SOCKS5 Proxy Server (Node.js)

A simple SOCKS5 proxy server implemented in Node.js with:

- Username/password authentication
- Support for domain names, IPv4, and IPv6
- HTTPS and TCP traffic forwarding
- Logging of connections and authentication

---

## Features

- **Configurable via `.env`**
- **Authentication:** Hardcoded credentials via `.env`
- **Supports:** TCP tunneling for HTTP/HTTPS requests
- **Logging:** Logs client connections, authentication, requests, and disconnections

---

## Requirements

- Node.js >= 18
- npm

---

## Installation

1. Clone the repository:

```bash
git clone <your-repo-url>
cd socks5-proxy
```

2. Install dependencies:
```
npm install
```

3. Create a .env file in the root folder:
```
PORT=1080
USERNAME=myName
PASSWORD=myPW
```

---
Running the Proxy
```
node index.js
```

You should see output like:
```
[+] SOCKS5 proxy server listening on port 1080
```
Testing the Proxy

Using curl with authentication:

```
curl --socks5-hostname localhost:1080 -U myName:myPW https://ipinfo.io/ip
```
Expected output: Your public IP address.


---
Example Logs
```
[+] Client connected from ::1:52268
[ ] Authentication attempt from ::1:52268: myName
[+] Authentication successful for myName from ::1:52268
[ ] Connection request to ipinfo.io:443 from ::1:52268
[+] Connected to target: ipinfo.io:443
[ ] Client disconnected: ::1:52268
[ ] Target connection closed: ipinfo.io:443
```
## Reflection

### What I Learned
I learned the SOCKS5 protocol, including handshake, authentication, and request handling. I also learned how to forward TCP traffic in Node.js and handle both domain names and IP addresses.

### Debugging Approach
I used detailed console logging at every stage (handshake, auth, connect) to identify where requests failed, especially for HTTPS traffic.

### Future Improvements
- Add persistent logging to a file or database.  
- Support more advanced authentication methods.  
- Add rate limiting and performance monitoring.


---
