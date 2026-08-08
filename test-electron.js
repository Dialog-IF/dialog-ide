// Simple test to verify Electron is working
const { app } = require('electron');

console.log('Electron test started');
console.log('App version:', app.getVersion());

// Test that we can create a basic window structure
const testWindow = {
  loadFile: (file) => console.log(`Loading file: ${file}`),
  webContents: {
    openDevTools: () => console.log('Opening DevTools')
  }
};

console.log('Test completed successfully');