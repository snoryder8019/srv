import express from 'express';

const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});

export default router;
