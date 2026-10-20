if ('serviceWorker' in navigator && !window.SiteBillBookAndroid) navigator.serviceWorker.register('/sw.js').catch(() => {});
