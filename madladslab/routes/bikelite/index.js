import express from "express";
const router = express.Router();


router.get("/", (req, res) => {
  const user = req.user;
  res.render("bikelite/index", { user });
});

export default router;