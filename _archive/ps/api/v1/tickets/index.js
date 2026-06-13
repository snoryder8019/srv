/**
 * Tickets API
 * Bug reports and feedback from testers
 */
import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';

const router = express.Router();

// Create new ticket
router.post('/', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Only testers can create tickets
    if (req.user.userRole !== 'tester' && req.user.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const {
      type,
      title,
      description,
      severity,
      characterId,
      characterName,
      location,
      userAgent,
      url
    } = req.body;

    if (!type || !title || !description) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: type, title, description'
      });
    }

    const db = getDb();
    const ticket = {
      type,
      title,
      description,
      severity: severity || 'medium',
      status: 'open', // open, in-progress, resolved, closed
      userId: req.user._id.toString(),
      username: req.user.username,
      characterId: characterId || null,
      characterName: characterName || null,
      location: location || null,
      userAgent: userAgent || null,
      url: url || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      comments: [],
      assignedTo: null
    };

    const result = await db.collection('tickets').insertOne(ticket);

    res.status(201).json({
      success: true,
      ticketId: result.insertedId,
      message: 'Ticket created successfully'
    });

  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ success: false, error: 'Failed to create ticket' });
  }
});

// Get all tickets (for admins/testers)
router.get('/', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const db = getDb();
    const { status, type, userId } = req.query;

    // Build query
    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;

    // If not admin, only show user's own tickets
    if (req.user.userRole !== 'admin') {
      query.userId = req.user._id.toString();
    } else if (userId) {
      query.userId = userId;
    }

    const tickets = await db.collection('tickets')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json({ success: true, tickets });

  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
  }
});

// Get single ticket
router.get('/:id', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const ticket = await db.collection('tickets')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    // Check authorization
    if (req.user.userRole !== 'admin' && ticket.userId !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    res.json({ success: true, ticket });

  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ticket' });
  }
});

// Update ticket status (admin only)
router.patch('/:id/status', async (req, res) => {
  try {
    if (!req.user || req.user.userRole !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { status } = req.body;
    const validStatuses = ['open', 'in-progress', 'resolved', 'closed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const db = getDb();
    const { ObjectId } = await import('mongodb');

    const result = await db.collection('tickets').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          status,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    res.json({ success: true, message: 'Ticket status updated' });

  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ success: false, error: 'Failed to update ticket' });
  }
});

// Add comment to ticket
router.post('/:id/comments', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { comment } = req.body;
    if (!comment) {
      return res.status(400).json({ success: false, error: 'Comment is required' });
    }

    const db = getDb();
    const { ObjectId } = await import('mongodb');

    const commentData = {
      userId: req.user._id.toString(),
      username: req.user.username,
      comment,
      timestamp: new Date()
    };

    const result = await db.collection('tickets').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $push: { comments: commentData },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    res.json({ success: true, message: 'Comment added' });

  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ success: false, error: 'Failed to add comment' });
  }
});

export default router;
