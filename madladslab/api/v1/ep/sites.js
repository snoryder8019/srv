import express from 'express';
import Site from '../models/Site.js'
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});
router.get('/all', async(req,res)=>{
try{
    const sites = await new Site().getAll()
    console.log(sites)

    res.json(sites)
}
catch(error){console.error(error)}
})

export default router;
