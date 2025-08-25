import express from 'express';
const router = express.Router();
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';
import  generateFormFields  from '../../api/v1/models/helpers/fields.js'; // Adjust the import path as necessary
import Location from '../../api/v1/models/grafitti/Location.js'; // Adjust the import path as necessary
import Task from '../../api/v1/models/grafitti/Task.js'; // Adjust the import path as necessary
import { getModelInstance } from '../../api/v1/models/helpers/loader.js';
router.get("/", async (req, res) => {
    try {
        // Define the absolute path to the models directory
        const modelsDir = path.join(process.cwd(), "api/v1/models/grafitti");
        // Read directory contents and filter only JavaScript files
        const modelFiles = fs.readdirSync(modelsDir)
            .filter(file => file.endsWith(".js")) // Keep only JS files
            .map(file => path.basename(file, ".js")); // Remove file extensions
        const user = req.user;
        const locations = await new Location().getAll();
        const tasks = await new Task().getAll();
        res.render("grafitti", { user, models: modelFiles, locations, tasks });


    } catch (error) {
        console.error(error);
        res.status(500).send("Internal Server Error");
    }
});
router.get('/invite/:inviteOffer',async (req,res)=>{
  try {
    const user = req.user;
    const { inviteOffer } = req.params;
    res.render("grafitti/invite", { user, inviteOffer });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
})
// routes/offers.js  // //routes/offers.js (keep path)


router.post('/claim', async (req, res) => {
  const { email, offer } = req.body || {};
  if (!email || !offer) return res.status(400).json({ ok:false, error:'Missing fields' });
  // TODO: save claim / send email
  return res.json({ ok:true });
});



router.get('/fields', async (req, res) => {
  try {
    const modelName = req.query.model;
    if (!modelName) return res.status(400).json({ error: 'Model name is required' });

    const modelPath = path.join(process.cwd(), 'api/v1/models/grafitti', `${modelName}.js`);
    if (!fs.existsSync(modelPath)) return res.status(404).json({ error: `Model ${modelName} not found` });

    const { default: Model } = await import(pathToFileURL(modelPath).href);
    if (!Model?.modelFields) return res.status(404).json({ error: 'Model fields not found' });

    const fields = generateFormFields(Model);
    return res.json(fields);
  } catch (e) {
    console.error('fields err:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
router.get('/edit/:model/:id', async (req, res) => {
  try {
    const { model, id } = req.params;
    const inst = await getModelInstance(model);
    const doc = await inst.getById(id);
    if (!doc) return res.status(404).send('Not found');
    res.render('./forms/editForm2.ejs', { model, doc });
  } catch (e) {
    console.error('edit err:', e);
    res.status(500).send('Internal Server Error');
  }
});

// update → reuse ModelHelper.updateById
router.post('/update/:model/:id', async (req, res) => {
  try {
    const { model, id } = req.params;
    const inst = await getModelInstance(model);
    await inst.updateById(id, req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('update err:', e);
    res.status(500).send('Internal Server Error');
  }
});

export default router;