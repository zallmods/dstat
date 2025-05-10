const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Data storage for tracking requests
const requestsData = {
  counters: {
    total: 0,
    byIP: {},
    byEndpoint: {},
  },
  history: [],
  MAX_HISTORY: 100
};

// Initialize history with zeros
for (let i = 0; i < requestsData.MAX_HISTORY; i++) {
  requestsData.history.push(0);
}

// Create a custom token for morgan to log the remote addr
morgan.token('remote-addr', function (req) {
  return req.headers['x-forwarded-for'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress;
});

// Create a write stream for request logs
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'access.log'), { flags: 'a' });

// Setup the logger middleware
app.use(morgan(':remote-addr :method :url :status :response-time ms', { 
  stream: accessLogStream 
}));

// DDOS monitoring middleware
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || 
             req.connection.remoteAddress || 
             req.socket.remoteAddress;
  const endpoint = req.path;

  // Skip monitoring for socket.io connections
  if (req.path.startsWith('/socket.io')) {
    return next();
  }

  // Increment total request counter
  requestsData.counters.total++;

  // Increment IP counter
  if (!requestsData.counters.byIP[ip]) {
    requestsData.counters.byIP[ip] = 1;
  } else {
    requestsData.counters.byIP[ip]++;
  }

  // Increment endpoint counter
  if (!requestsData.counters.byEndpoint[endpoint]) {
    requestsData.counters.byEndpoint[endpoint] = 1;
  } else {
    requestsData.counters.byEndpoint[endpoint]++;
  }

  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Send index.html when accessing root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Test route to generate traffic
app.get('/test', (req, res) => {
  res.send('Test endpoint');
});

// API to get top IPs
app.get('/api/top-ips', (req, res) => {
  const topIPs = Object.entries(requestsData.counters.byIP)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([ip, count]) => ({ ip, count }));

  res.json(topIPs);
});

// API to get top endpoints
app.get('/api/top-endpoints', (req, res) => {
  const topEndpoints = Object.entries(requestsData.counters.byEndpoint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([endpoint, count]) => ({ endpoint, count }));

  res.json(topEndpoints);
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected');

  // Send initial data on connection
  socket.emit('initialData', {
    history: requestsData.history,
    totalRequests: requestsData.counters.total,
    uniqueIPs: Object.keys(requestsData.counters.byIP).length
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Update metrics every second
let lastTotal = 0;
setInterval(() => {
  // Calculate new requests in the last second
  const newRequests = requestsData.counters.total - lastTotal;
  lastTotal = requestsData.counters.total;

  // Update history
  requestsData.history.shift();
  requestsData.history.push(newRequests);

  // Broadcast to all connected clients
  io.emit('newDataPoint', {
    value: newRequests,
    totalRequests: requestsData.counters.total,
    uniqueIPs: Object.keys(requestsData.counters.byIP).length
  });
}, 1000);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DDoS Monitoring Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to view the monitoring dashboard`);
});
