/**
 * Storyline View Routes
 * Routes for viewing storylines in the TOME
 */
import express from 'express';

const router = express.Router();

/**
 * GET /storylines/tome
 * Main TOME viewer for all storylines
 */
router.get('/tome', (req, res) => {
  res.render('storylines/tome', {
    title: 'TOME - Storylines',
    user: req.user,
    character: res.locals.character
  });
});

export default router;
