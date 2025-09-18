    import express from "express";
    const router = express.Router();

    router.get("/", (req, res) => {
        res.render("contest/user", { playerId: req.cookies?.contest_pid || null });
    });
    // user routes go here

    export default router;
