// Main process calls window.setStatus("Step 2: Click at 400, 300") via executeJavaScript.
window.setStatus = (text) => { document.getElementById('text').textContent = text; };
