import express from "express";
import chalk from "chalk";
import fs from "fs";
import generateFormFields from "../../api/v1/models/helpers/fields.js";
import path from "path";
import QRCode from 'qrcode';
import Volunteer from "../../api/v1/models/Volunteer.js"; // Import the Volunteer model
const router = express.Router();

router.get("/", (req, res) => {

    const user = req.user;
    res.render("signups/signups", { user });
});
router.get("/volunteers",async (req, res) => {
    const user = req.user;
    const Model =await new Volunteer();

    const formElements= generateFormFields(Model);
    console.log(chalk.green(JSON.stringify(formElements)));
    res.render("signups/volunteers", { user:user,formElements:formElements });
});
router.get("/likeness", (req, res) => {
    const user = req.user;
    res.render("signups/likeness", { user });
});
router.get("/testimonials", (req, res) => {
    const user = req.user;
    res.render("signups/testimonials", { user });
});


///

// server.js



router.get('/qr.png', async (req, res) => {
  try {
    const { text = '', size = 256, margin = 1 } = req.query;
    const buf = await QRCode.toBuffer(String(text), { type: 'png', width: +size, margin: +margin });
    res.type('png').send(buf);
  } catch (e) { res.sendStatus(400); }
});

router.get('/qr.svg', async (req, res) => {
  try {
    const { text = '', size = 256, margin = 1 } = req.query;
    const svg = await QRCode.toString(String(text), { type: 'svg', width: +size, margin: +margin });
    res.type('image/svg+xml').send(svg);
  } catch (e) { res.sendStatus(400); }
});




////

export default router;