function runScript(script) {
  const logDiv = document.getElementById('log');
  logDiv.textContent = `Running ${script}...\n`;
  fetch(`/api/run/${script}`)
    .then(response => {
      if (!response.body) throw new Error('No response body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      function read() {
        reader.read().then(({ done, value }) => {
          if (done) return;
          logDiv.textContent += decoder.decode(value);
          logDiv.scrollTop = logDiv.scrollHeight;
          read();
        });
      }
      read();
    })
    .catch(err => {
      logDiv.textContent += `\nError: ${err.message}`;
    });
}
