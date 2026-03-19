import app from '../app.js';
import { config } from '../config/config.js';

const port = config.PORT || 3601;

app.listen(port, () => {
  console.log(`[w2Marketing] Running on port ${port}`);
});
