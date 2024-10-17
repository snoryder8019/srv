import express from "express"
const router = express.Router()


router.get('/', async(req,res)=>{
try{
    console.log(chalk.bgMagenta('admin route'))
}
catch(error){console.error(error)}
})


export default router