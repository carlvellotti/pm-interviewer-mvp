#!/usr/bin/env node

/**
 * Backend API Tests for Interview Categories
 * Tests the new category-based endpoints
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3002/api';

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(`   Error: ${error.message}`);
    return false;
  }
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

async function main() {
  console.log('🧪 Testing Interview Categories Backend\n');
  console.log(`API Base: ${API_BASE}\n`);
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: GET /questions returns categories
  if (await test('GET /questions returns categories', async () => {
    const data = await fetchJSON(`${API_BASE}/questions`);
    
    if (!data.categories) throw new Error('No categories field');
    if (!Array.isArray(data.categories)) throw new Error('categories is not an array');
    if (data.categories.length !== 5) throw new Error(`Expected 5 categories, got ${data.categories.length}`);
    
    // Check category structure
    const category = data.categories[0];
    if (!category.id) throw new Error('Category missing id');
    if (!category.name) throw new Error('Category missing name');
    if (!category.description) throw new Error('Category missing description');
    if (!category.aiGuidance) throw new Error('Category missing aiGuidance');
    if (!Array.isArray(category.questions)) throw new Error('Category questions is not an array');
    
    console.log(`   Categories: ${data.categories.map(c => c.id).join(', ')}`);
  })) passed++; else failed++;
  
  // Test 2: All categories have 12 questions
  if (await test('All categories have 12 questions each', async () => {
    const data = await fetchJSON(`${API_BASE}/questions`);
    
    for (const cat of data.categories) {
      if (cat.questions.length !== 12) {
        throw new Error(`Category "${cat.id}" has ${cat.questions.length} questions, expected 12`);
      }
    }
    
    console.log(`   Total questions: ${data.categories.reduce((sum, c) => sum + c.questions.length, 0)}`);
  })) passed++; else failed++;
  
  // Test 3: Questions have required fields
  if (await test('Questions have required fields', async () => {
    const data = await fetchJSON(`${API_BASE}/questions`);
    const question = data.categories[0].questions[0];
    
    if (!question.id) throw new Error('Question missing id');
    if (!question.text) throw new Error('Question missing text');
    if (!question.rationale) throw new Error('Question missing rationale');
    if (typeof question.estimatedDuration !== 'number') throw new Error('Question missing estimatedDuration');
    if (!question.type) throw new Error('Question missing type');
    
    console.log(`   Sample question: ${question.id} (${question.estimatedDuration} min, ${question.type})`);
  })) passed++; else failed++;
  
  // Test 4: AI Guidance has required fields
  if (await test('AI Guidance has required fields', async () => {
    const data = await fetchJSON(`${API_BASE}/questions`);
    const guidance = data.categories[0].aiGuidance;
    
    if (!guidance.systemStyle) throw new Error('Missing systemStyle');
    if (!guidance.questionApproach) throw new Error('Missing questionApproach');
    if (!guidance.pacing) throw new Error('Missing pacing');
    if (!Array.isArray(guidance.probeFor)) throw new Error('probeFor is not an array');
    if (!Array.isArray(guidance.avoid)) throw new Error('avoid is not an array');
    if (!Array.isArray(guidance.evaluationSignals)) throw new Error('evaluationSignals is not an array');
    
    console.log(`   Guidance fields: ${Object.keys(guidance).join(', ')}`);
  })) passed++; else failed++;
  
  // Test 5: Backward compatibility - old fields still present
  if (await test('Backward compatibility: old fields present', async () => {
    const data = await fetchJSON(`${API_BASE}/questions`);
    
    if (!Array.isArray(data.questions)) throw new Error('Old questions field missing');
    if (!Array.isArray(data.evaluationFocus)) throw new Error('Old evaluationFocus field missing');
    if (!Array.isArray(data.personas)) throw new Error('Old personas field missing');
    if (!data.defaults) throw new Error('Old defaults field missing');
    
    console.log(`   Old format intact: questions(${data.questions.length}), personas(${data.personas.length})`);
  })) passed++; else failed++;
  
  // Test 6: POST /interview/start-session with NEW format
  if (await test('POST /start-session with NEW format (categoryId + questionIds)', async () => {
    const payload = {
      categoryId: 'behavioral',
      questionIds: ['disagreed-engineer', 'owned-decision', 'failure-story'],
      difficulty: 'medium'
    };
    
    const data = await fetchJSON(`${API_BASE}/interview/start-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!data.session) throw new Error('No session returned');
    if (!data.session.clientSecret) throw new Error('No clientSecret');
    if (!data.session.instructions) throw new Error('No instructions');
    if (!data.categoryId) throw new Error('No categoryId in response');
    if (data.categoryId !== 'behavioral') throw new Error('Wrong categoryId');
    if (!data.categoryName) throw new Error('No categoryName');
    if (!Array.isArray(data.questionStack)) throw new Error('No questionStack');
    if (data.questionStack.length !== 3) throw new Error('Wrong number of questions');
    if (typeof data.estimatedDuration !== 'number') throw new Error('No estimatedDuration');
    
    console.log(`   Session created: ${data.categoryName}, ${data.questionStack.length} questions, ~${data.estimatedDuration} min`);
    console.log(`   Instructions length: ${data.session.instructions.length} chars`);
    
    // Verify instructions include category guidance
    if (!data.session.instructions.includes('STAR')) {
      throw new Error('Instructions missing category guidance (expected STAR for behavioral)');
    }
  })) passed++; else failed++;
  
  // Test 7: POST /interview/start-session with OLD format (backward compatibility)
  if (await test('POST /start-session with OLD format (questionStack)', async () => {
    const payload = {
      questionStack: [
        { id: 'test1', text: 'Test question 1', prompt: 'Test question 1' },
        { id: 'test2', text: 'Test question 2', prompt: 'Test question 2' }
      ],
      difficulty: 'medium'
    };
    
    const data = await fetchJSON(`${API_BASE}/interview/start-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!data.session) throw new Error('No session returned');
    if (!data.session.clientSecret) throw new Error('No clientSecret');
    if (data.categoryId !== null) throw new Error('categoryId should be null for old format');
    if (!Array.isArray(data.questionStack)) throw new Error('No questionStack');
    if (data.questionStack.length !== 2) throw new Error('Wrong number of questions');
    
    console.log(`   Old format works: ${data.questionStack.length} questions`);
  })) passed++; else failed++;
  
  // Test 8: Validation - invalid category ID
  if (await test('Validation: rejects invalid category ID', async () => {
    const payload = {
      categoryId: 'invalid-category',
      questionIds: ['test-q'],
      difficulty: 'medium'
    };
    
    try {
      await fetchJSON(`${API_BASE}/interview/start-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      throw new Error('Should have rejected invalid category');
    } catch (error) {
      if (!error.message.includes('400')) throw new Error('Wrong error code');
    }
    
    console.log(`   Properly rejects invalid category`);
  })) passed++; else failed++;
  
  // Test 9: Validation - question ID not in category
  if (await test('Validation: rejects question ID not in category', async () => {
    const payload = {
      categoryId: 'behavioral',
      questionIds: ['disagreed-engineer', 'invalid-question-id'],
      difficulty: 'medium'
    };
    
    try {
      await fetchJSON(`${API_BASE}/interview/start-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      throw new Error('Should have rejected invalid question ID');
    } catch (error) {
      if (!error.message.includes('400')) throw new Error('Wrong error code');
    }
    
    console.log(`   Properly rejects invalid question IDs`);
  })) passed++; else failed++;
  
  // Test 10: Product Sense category has exploratory questions
  if (await test('Product Sense questions marked as exploratory', async () => {
    const data = await fetchJSON(`${API_BASE}/questions`);
    const productSense = data.categories.find(c => c.id === 'product-sense');
    
    if (!productSense) throw new Error('No product-sense category');
    
    const exploratoryCount = productSense.questions.filter(q => q.type === 'exploratory').length;
    if (exploratoryCount !== 12) throw new Error(`Expected all 12 questions to be exploratory, got ${exploratoryCount}`);
    
    console.log(`   All ${exploratoryCount} Product Sense questions are exploratory`);
  })) passed++; else failed++;
  
  // Test 11: Different categories have different durations
  if (await test('Categories have appropriate durations', async () => {
    const data = await fetchJSON(`${API_BASE}/questions`);
    
    const behavioral = data.categories.find(c => c.id === 'behavioral');
    const productSense = data.categories.find(c => c.id === 'product-sense');
    
    const behavioralAvg = behavioral.questions.reduce((sum, q) => sum + q.estimatedDuration, 0) / behavioral.questions.length;
    const productSenseAvg = productSense.questions.reduce((sum, q) => sum + q.estimatedDuration, 0) / productSense.questions.length;
    
    if (behavioralAvg < 7 || behavioralAvg > 10) throw new Error(`Behavioral avg ${behavioralAvg} not in 7-10 range`);
    if (productSenseAvg < 12 || productSenseAvg > 15) throw new Error(`Product Sense avg ${productSenseAvg} not in 12-15 range`);
    
    console.log(`   Behavioral avg: ${behavioralAvg.toFixed(1)} min, Product Sense avg: ${productSenseAvg.toFixed(1)} min`);
  })) passed++; else failed++;
  
  // Summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

