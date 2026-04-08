// Debug mode: เพิ่ม ?debug=1 ใน URL เพื่อเปิด devtools
if (!new URLSearchParams(window.location.search).has('debug')) {
  // Block F12, Ctrl+Shift+I/J/C, Ctrl+U (view source)
  document.addEventListener('keydown', function(e) {
    if (e.key === 'F12') { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) { e.preventDefault(); return false; }
    if (e.ctrlKey && e.key === 'u') { e.preventDefault(); return false; }
  });

  // Block right-click
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
}
