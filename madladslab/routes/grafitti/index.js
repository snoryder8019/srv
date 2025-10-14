import express from 'express';
const router = express.Router();
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';
import nodemailer from 'nodemailer';
import multer from 'multer';
import Invite from '../../api/v1/models/grafitti/Invite.js';

import generateFormFields from '../../api/v1/models/helpers/fields.js';
import Location from '../../api/v1/models/grafitti/Location.js';
import Task from '../../api/v1/models/grafitti/Task.js';
import Qr from '../../api/v1/models/grafitti/Qr.js';
import Gencon from '../../api/v1/models/grafitti/Gencon.js';
import { uploadToLinode } from '../../plugins/aws_sdk/setup.js';
import { getModelInstance } from '../../api/v1/models/helpers/loader.js';



function getAllModelFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllModelFiles(fullPath, fileList);
    } else if (file.endsWith('.js')) {
      fileList.push(fullPath);
    }
  });
  return fileList;
}
// Nodemailer setup (use your .env or config)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});
const upload = multer(); // For parsing multipart/form-data
router.get("/", async (req, res) => {
  try {
    const modelsDir = path.join(process.cwd(), "api/v1/models/grafitti");
    const modelFiles = fs.readdirSync(modelsDir)
      .filter(file => file.endsWith(".js"))
      .map(file => path.basename(file, ".js"));
    const user = req.user;
    const locations = await new Location().getAll();
    const gencons = await new Gencon().getAll();
    const tasks = await new Task().getAll();
    const qrs = await new Qr().getAll();
    res.render("grafitti", { user, models: modelFiles, locations, tasks, qrs,gencons });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

router.get('/invite/:inviteOffer', async (req, res) => {
  try {
    const user = req.user;
    const { inviteOffer } = req.params;
    res.render("grafitti/invite", { user, inviteOffer });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

// Send invite and save to DB, then email confirmation link
router.post('/invite/send', async (req, res) => {
  const { email, name, type, link, description } = req.body;
  if (!email || !type) return res.status(400).json({ ok: false, error: 'Missing fields' });

  try {
    // Create invite in DB
    const invite = await new Invite().create({
      email,
      name,
      type,
      link,
      description,
      inviteStatus: 'notClaimed',
      confirmed: false,
      createdAt: new Date()
    });

    // Generate confirmation link
    const confirmUrl = `${req.protocol}://${req.get('host')}/grafitti/invite/confirm/${invite._id}`;

    // Send email
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: email,
      subject: 'Your Invite Link',
      html: `<p>Hello${name ? ' ' + name : ''},<br>
        You have been invited!<br>
        <a href="${confirmUrl}">Click here to confirm your invite</a>
        </p>`
    });

    res.json({ ok: true, inviteId: invite._id });
  } catch (e) {
    console.error('invite/send err:', e);
    res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

// Confirmation route
router.get('/invite/confirm/:inviteId', async (req, res) => {
  const { inviteId } = req.params;
  try {
    const inst = await getModelInstance('Invite');
    const invite = await inst.getById(inviteId);
    if (!invite) return res.status(404).send('Invite not found');

    // Update invite as confirmed
    await inst.updateById(inviteId, { confirmed: true, inviteStatus: 'Claimed', confirmedAt: new Date() });

    res.render('grafitti/inviteConfirmed', { invite });
  } catch (e) {
    console.error('invite/confirm err:', e);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/claim', async (req, res) => {
  const { email, offer } = req.body || {};
  if (!email || !offer) return res.status(400).json({ ok: false, error: 'Missing fields' });
  // TODO: save claim / send email
  return res.json({ ok: true });
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
router.get('/delete/:model/:id', async (req, res) => {
  try {
    const { model, id } = req.params;
    const inst = await getModelInstance(model);
    await inst.deleteById(id);
    res.json({ success: true });
  } catch (e) {
    console.error('delete err:', e);
    res.status(500).send('Internal Server Error');
  }
});
// Route to list all available models for forms
// Example route
router.get('/forms-index', async (req, res) => {
  try {
    const modelsDir = path.join(process.cwd(), "api/v1/models/grafitti");
    const modelFiles = getAllModelFiles(modelsDir); // This should return an array
    res.render('grafitti/forms/index', { models: modelFiles });
  } catch (e) {
    console.error('forms-index err:', e);
    res.status(500).send('Internal Server Error');
  }
});
router.get('/forms/:model', async (req, res) => {
  try {
    // Capitalize first letter to match file name
    let { model } = req.params;
    model = model.charAt(0).toUpperCase() + model.slice(1);
    const inst = await getModelInstance(model);
    const fields = inst.constructor.modelFields;
    res.render('grafitti/forms/index.ejs', { model:model, fields });
  } catch (e) {
    console.error('forms/:model err:', e);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Generate a unique file name (e.g., with timestamp)
    const ext = path.extname(req.file.originalname);
    const newFileKey = `uploads/${Date.now()}_${req.file.originalname}`;

    // Upload buffer to Linode
    const url = await uploadToLinode(req.file.buffer, newFileKey);

    res.json({ url });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

export default router;