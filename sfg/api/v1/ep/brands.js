import express from 'express';
import Brand from '../models/Brand.js'
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});
router.get('/all', async(req,res)=>{
try{
    const brands = await new Brand().getAll()
    console.log(brands)
    
    res.json(brands)
}
catch(error){console.error(error)}
})
export default router;
