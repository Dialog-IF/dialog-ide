#!/usr/bin/env node

/**
 * Simple test runner for Skein engine components
 */

console.log('Running Skein engine tests...');

// Test that we can import all our modules
try {
  // First build the project
  const { execSync } = require('child_process');
  console.log('Building project...');
  execSync('npm run build', { stdio: 'inherit' });

  // Check if key files exist in dist
  const fs = require('fs');
  const path = require('path');

  // Check if dist directory exists and has built files
  const distDir = './dist';
  if (fs.existsSync(distDir)) {
    console.log('✓ Dist directory created');

    // List files in dist to verify build
    const distFiles = fs.readdirSync(distDir);
    console.log(`✓ Found ${distFiles.length} files in dist`);

    // Test that we can import modules from dist
    console.log('\nTesting module imports...');

    // Test basic imports
    const processModule = require('./dist/dialoged/skein/process');
    const sessionModule = require('./dist/dialoged/skein/session');
    const treeModule = require('./dist/dialoged/skein/tree');
    const serviceModule = require('./dist/dialoged/skein/service');
    const dynamicModule = require('./dist/dialoged/skein/dynamic');
    const persistenceModule = require('./dist/dialoged/skein/persistence');
    const ioModule = require('./dist/dialoged/skein/io');

    console.log('✓ All modules imported successfully');

    // Test that we can create instances
    const tree = new treeModule.SkeinTree('dgdebug', 12345);
    console.log('✓ SkeinTree instance created');

    const dynamicProcessor = new dynamicModule.DynamicProcessor();
    console.log('✓ DynamicProcessor instance created');

    console.log('\nAll tests passed! The Skein engine components are properly structured.');

  } else {
    console.log('✗ Dist directory not found');
    process.exit(1);
  }

} catch (error) {
  console.error('Test failed:', error);
  process.exit(1);
}