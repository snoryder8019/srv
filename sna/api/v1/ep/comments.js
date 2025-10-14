import express from 'express';
import Comment from '../models/Comment.js';
const router = express.Router();

/**
 * GET /api/v1/comments/:articleUrl
 * Get all comments for an article
 */
router.get('/:articleUrl', async (req, res) => {
  try {
    const articleUrl = decodeURIComponent(req.params.articleUrl);
    const commentModel = new Comment();
    const comments = await commentModel.getAll({ articleUrl });

    res.json({
      success: true,
      count: comments.length,
      data: comments
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/v1/comments
 * Add a new comment (requires authentication)
 */
router.post('/', async (req, res) => {
  try {
    const user = req.user;

    // Check if user is authenticated
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const { articleUrl, articleTitle, articleSource, commentText } = req.body;

    if (!articleUrl || !commentText) {
      return res.status(400).json({
        success: false,
        error: 'articleUrl and commentText are required'
      });
    }

    const commentData = {
      articleUrl,
      articleTitle: articleTitle || '',
      articleSource: articleSource || '',
      userId: user.id || user._id?.toString() || 'unknown',
      userEmail: user.email || '',
      userName: user.displayName || user.name || user.email || 'Anonymous',
      commentText,
      createdAt: new Date(),
      likes: 0
    };

    const commentModel = new Comment();
    const newComment = await commentModel.create(commentData);

    res.json({
      success: true,
      data: newComment
    });
  } catch (error) {
    console.error('Error creating comment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/v1/comments/:commentId
 * Delete a comment (user must own the comment or be admin)
 */
router.delete('/:commentId', async (req, res) => {
  try {
    const user = req.user;
    const commentId = req.params.commentId;

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const commentModel = new Comment();
    const comment = await commentModel.getById(commentId);

    if (!comment) {
      return res.status(404).json({
        success: false,
        error: 'Comment not found'
      });
    }

    // Check if user owns the comment or is admin
    const userId = user.id || user._id?.toString();
    if (comment.userId !== userId && !user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'You can only delete your own comments'
      });
    }

    await commentModel.deleteById(commentId);

    res.json({
      success: true,
      data: comment
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/v1/comments
 * Get all comments (admin only)
 */
router.get('/', async (req, res) => {
  try {
    const user = req.user;

    if (!user || !user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    const commentModel = new Comment();
    const allComments = await commentModel.getAll({});

    res.json({
      success: true,
      count: allComments.length,
      data: allComments
    });
  } catch (error) {
    console.error('Error fetching all comments:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
