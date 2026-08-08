/**
 * Test file for Skein engine components
 */

// Import all components
import {
  SkeinProcess,
  SkeinSession,
  SkeinTree,
  SkeinService,
  DynamicProcessor,
  PersistenceManager,
  IoDetector
} from './src/dialoged/skein';

console.log('Testing Skein engine components...');

try {
  // Test tree creation
  const tree = SkeinTree.newTree('dgdebug', 12345);
  console.log('✓ Tree created successfully');

  // Test session creation
  const config = {
    engine: 'dgdebug' as const,
    seed: 12345,
    gamePath: './test.zblorb'
  };

  const session = SkeinSession.createNew(config);
  console.log('✓ Session created successfully');

  // Test dynamic processor
  const dynamicProcessor = new DynamicProcessor();
  console.log('✓ Dynamic processor created successfully');

  // Test persistence manager
  const persistenceManager = new PersistenceManager('./test-sessions');
  console.log('✓ Persistence manager created successfully');

  // Test IO detector
  const ioDetector = new IoDetector();
  console.log('✓ IO detector created successfully');

  console.log('\nAll Skein engine components initialized successfully!');

} catch (error) {
  console.error('Error testing Skein engine:', error);
}