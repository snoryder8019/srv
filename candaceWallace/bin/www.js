import app from '../app.js';
import { config } from '../config/config.js';

const port = config.PORT || 3500;

app.listen(port, () => {
  console.log(`[candaceWallace] Running on port ${port}`);
});
