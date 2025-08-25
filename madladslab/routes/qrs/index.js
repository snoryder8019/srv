import express from "express"
const router = express.Router()
import QRCode from 'qrcode'
import chalk from "chalk"

router.get("/", (req, res) => {
    console.log("QR Code Home")
})

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


export default router