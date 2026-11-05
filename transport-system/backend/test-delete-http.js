/**
 * Test script to make actual HTTP DELETE request to the backend
 * and capture the exact response
 */

const http = require('http');

// First, login to get a token
function login() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: 'admin@bihartransport.in',
      password: 'admin123'
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.data?.token) {
            resolve(parsed.data.token);
          } else {
            reject(new Error('Login failed: ' + data));
          }
        } catch (e) {
          reject(new Error('Parse error: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function deleteTrip(token, tripId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/trips/${tripId}`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    console.log('=== HTTP DELETE Test for Trip ID 1 ===\n');
    
    console.log('Step 1: Logging in...');
    const token = await login();
    console.log('  Got token:', token.substring(0, 20) + '...');
    
    console.log('\nStep 2: Sending DELETE /api/trips/1...');
    const result = await deleteTrip(token, 1);
    
    console.log('  Status Code:', result.statusCode);
    console.log('  Response Body:', result.body);
    
    if (result.statusCode === 500) {
      console.log('\nDIAGNOSIS: Server returned 500');
      console.log('This confirms the backend is throwing an unhandled exception');
    } else if (result.statusCode === 400) {
      console.log('\nDIAGNOSIS: Server returned 400 (ValidationError caught correctly)');
    } else if (result.statusCode === 409) {
      console.log('\nDIAGNOSIS: Server returned 409 (Conflict)');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
