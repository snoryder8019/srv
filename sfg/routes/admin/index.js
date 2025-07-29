import express from "express"
const router = express.Router()
import chalk from "chalk"

async function isAdmin(req, res, next) {
    const user = req.user;
    console.log(`user:${user}`)
    if (user && user.isAdmin === true) {
        return next();
    } else {
        return res.status(401).send('Unauthorized');
    }
}
router.get('/', isAdmin, async (req, res) => {
    try {
        const user = req.user;
        res.render("admin", {user:user});
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});


export default router