const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 50901;
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Function to fetch a web page using multiple methods
async function fetchWebPage(targetUrl) {
    console.log(`Fetching page: ${targetUrl}`);
    
    // Validate URL
    try {
        new URL(targetUrl);
    } catch (e) {
        throw new Error(`Invalid URL: ${targetUrl}`);
    }
    
    // Try multiple methods to fetch the page
    const methods = [
        fetchWithHttpClient,
        fetchWithAllOrigins,
        fetchWithCorsproxy
    ];
    
    let lastError = null;
    
    for (let i = 0; i < methods.length; i++) {
        const method = methods[i];
        try {
            console.log(`Trying method ${i+1}/${methods.length}`);
            const content = await method(targetUrl);
            
            if (!content || content.length === 0) {
                console.error(`Method ${i+1} returned empty content`);
                throw new Error('Empty content received');
            }
            
            console.log(`Method ${i+1} succeeded, content length: ${content.length}`);
            return content;
        } catch (error) {
            console.error(`Method ${i+1} failed:`, error.message);
            lastError = error;
            // Continue to next method
        }
    }
    
    // If we get here, all methods failed
    throw lastError || new Error('All methods failed to fetch the web page');
}

// Method 1: Using http/https client
function fetchWithHttpClient(targetUrl) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(targetUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        // Improved headers to mimic a real browser
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0'
        };
        
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'GET',
            headers: headers
        };
        
        // Add port if specified in the URL
        if (parsedUrl.port) {
            options.port = parsedUrl.port;
        }
        
        console.log(`Making direct request to ${parsedUrl.hostname}${parsedUrl.path}`);
        
        const req = protocol.request(options, (res) => {
            console.log(`Response status: ${res.statusCode}`);
            
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, targetUrl).toString();
                console.log(`Redirecting to: ${redirectUrl}`);
                return fetchWithHttpClient(redirectUrl).then(resolve).catch(reject);
            }
            
            if (res.statusCode !== 200) {
                return reject(new Error(`Request failed with status code ${res.statusCode}`));
            }
            
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString();
                resolve(body);
            });
        });
        
        req.on('error', (err) => {
            console.error(`Error in direct request:`, err.message);
            reject(err);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
        
        req.setTimeout(15000); // 15 seconds timeout
        req.end();
    });
}

// Method 2: Using allorigins.win
async function fetchWithAllOrigins(targetUrl) {
    console.log(`Trying allorigins.win for ${targetUrl}`);
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
        throw new Error(`allorigins.win request failed with status ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.contents) {
        throw new Error('Invalid response from allorigins.win');
    }
    
    return data.contents;
}

// Method 3: Using corsproxy.io
async function fetchWithCorsproxy(targetUrl) {
    console.log(`Trying corsproxy.io for ${targetUrl}`);
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
    
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
        throw new Error(`corsproxy.io request failed with status ${response.status}`);
    }
    
    return await response.text();
}

const server = http.createServer(async (req, res) => {
    console.log(`${req.method} ${req.url}`);
    
    // Set CORS headers - be very permissive
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    
    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    // Parse URL
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // Handle fetch-page endpoint
    if (pathname === '/api/fetch-page' && (req.method === 'GET' || req.method === 'POST')) {
        // Get URL from query params or request body
        let targetUrl = '';
        
        if (req.method === 'GET') {
            targetUrl = parsedUrl.query.url;
        } else if (req.method === 'POST') {
            // Handle POST request (not implemented yet, but prepared for future)
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'POST method not implemented yet' }));
            return;
        }
        
        if (!targetUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL parameter is required' }));
            return;
        }
        
        try {
            console.log(`Fetching page: ${targetUrl}`);
            const html = await fetchWebPage(targetUrl);
            
            if (!html) {
                throw new Error('Empty HTML content received');
            }
            
            console.log(`Successfully fetched page, sending response with content length: ${html.length}`);
            
            // Set proper headers for JSON response
            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            
            // Send response with HTML content
            const responseJson = JSON.stringify({ html });
            res.end(responseJson);
            
            console.log(`Response sent successfully, JSON length: ${responseJson.length}`);
        } catch (error) {
            console.error('Error fetching page:', error);
            console.error('Error stack:', error.stack);
            
            // Set proper headers for error response
            res.writeHead(500, { 
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            
            // Send detailed error information
            res.end(JSON.stringify({ 
                error: error.message,
                stack: error.stack,
                name: error.name
            }));
        }
        return;
    }
    
    // Special test endpoint
    if (pathname === '/test') {
        fs.readFile(path.join(__dirname, 'test.html'), (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(content, 'utf-8');
        });
        return;
    }
    
    // Handle static files
    let filePath = pathname;
    if (filePath === '/' || filePath === '') {
        filePath = '/index.html';
    }
    
    // Get the full path
    const fullPath = path.join(__dirname, filePath);
    
    // Get file extension
    const extname = path.extname(fullPath);
    
    // Set content type
    const contentType = MIME_TYPES[extname] || 'text/plain';
    
    // Read file
    fs.readFile(fullPath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // Page not found
                fs.readFile(path.join(__dirname, '404.html'), (err, content) => {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end(content, 'utf-8');
                });
            } else {
                // Server error
                res.writeHead(500);
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            // Success
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});