require('dotenv').config();
const { init } = require('../lib/pineconeClient');

(async () => {
  const index = await init();

  if (index.deleteAll) {
    await index.deleteAll();
    console.log('Index cleared via deleteAll()');
  } else {
    await index.delete({ deleteAll: true });
    console.log('Index cleared via delete({deleteAll:true})');
  }
})();
