/**
 * Test to verify VIX badge is visible
 * Run this in browser console
 */

// Check if IndiaVIXBadge component is being rendered
console.log('=== VIX Badge Visibility Check ===');

// Check if the badge div exists in DOM
const badges = document.querySelectorAll('div[style*="minWidth"]');
console.log('Found divs with minWidth:', badges.length);

// Look for any element containing "IVIX"
const ivixElements = Array.from(document.querySelectorAll('*')).filter(el => 
  el.textContent.includes('IVIX')
);
console.log('Found elements with IVIX:', ivixElements.length);
ivixElements.forEach(el => {
  console.log('IVIX element:', el.tagName, el.textContent.slice(0, 50));
});

// Check for the flex container
const flexContainers = document.querySelectorAll('div[style*="display: flex"]');
console.log('Found flex containers:', flexContainers.length);

// Check title
const titleElement = document.querySelector('h2');
if (titleElement) {
  console.log('Title found:', titleElement.textContent);
  console.log('Title parent:', titleElement.parentElement?.style.display);
}

// Network check
console.log('Checking VIX API...');
fetch('http://localhost:8000/api/vix')
  .then(r => r.json())
  .then(data => console.log('✅ VIX API Response:', data))
  .catch(err => console.error('❌ VIX API Error:', err.message));
