const { generate } = require('youtube-po-token-generator');

async function getPoToken() {
  try {
    const { visitorData, poToken } = await generate();
    console.log('VisitorData:', visitorData);
    console.log('PoToken:', poToken);
  } catch (err) {
    console.error('Error generating token:', err);
  }
}

getPoToken();
