module.exports = {
  getCspPolicy(dev = false) {
    return `
      default-src 'self';
      script-src 'self' 'unsafe-inline' 'unsafe-eval';
      style-src 'self' 'unsafe-inline';
      connect-src 'self' ${process.env.CONNECT_SRC} ${process.env.API_URL} wss://${process.env.CONNECT_SRC};
      img-src 'self' data:;
      font-src 'self';
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
      block-all-mixed-content;
      upgrade-insecure-requests;
    `.replace(/\s+/g, ' ').trim();
  }
}