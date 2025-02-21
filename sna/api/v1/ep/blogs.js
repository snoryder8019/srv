import express from 'express';
import Blog from '../models/Blog.js'
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});
router.get('/all', async(req,res)=>{
try{
    const blogs = await new Blog().getAll()
    console.log(blogs)
    
    res.json(blogs)
}
catch(error){console.error(error)}
})
export default router;
