/**
 * User Analytics Model
 * Tracks user behavior, achievements, and activity
 */
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';

export class UserAnalytics {
  /**
   * Track user action
   */
  static async trackAction(userId, actionType, metadata = {}) {
    const db = getDb();
    const action = {
      userId: new ObjectId(userId),
      actionType,
      metadata,
      timestamp: new Date(),
      sessionId: metadata.sessionId || null
    };

    await db.collection('userActions').insertOne(action);

    // Update user stats
    await this.updateUserStats(userId, actionType, metadata);

    // Check for achievements
    await this.checkAchievements(userId, actionType, metadata);

    return action;
  }

  /**
   * Update user statistics
   */
  static async updateUserStats(userId, actionType, metadata = {}) {
    const db = getDb();
    const updateFields = {
      lastActive: new Date()
    };

    // Increment specific counters based on action type
    const incrementFields = {
      'stats.totalActions': 1
    };

    switch (actionType) {
      case 'asset_created':
        incrementFields['stats.assetsCreated'] = 1;
        break;
      case 'asset_submitted':
        incrementFields['stats.assetsSubmitted'] = 1;
        break;
      case 'vote_cast':
        incrementFields['stats.votesCast'] = 1;
        break;
      case 'suggestion_made':
        incrementFields['stats.suggestionsMade'] = 1;
        break;
      case 'page_view':
        incrementFields['stats.pageViews'] = 1;
        if (metadata.page) {
          incrementFields[`stats.pagesByType.${metadata.page}`] = 1;
        }
        break;
      case 'login':
        incrementFields['stats.logins'] = 1;
        break;
      case 'character_created':
        incrementFields['stats.charactersCreated'] = 1;
        break;
      case 'zone_visited':
        incrementFields['stats.zonesVisited'] = 1;
        break;
    }

    await db.collection(collections.users).updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: updateFields,
        $inc: incrementFields
      }
    );
  }

  /**
   * Check and award achievements
   */
  static async checkAchievements(userId, actionType, metadata = {}) {
    const db = getDb();
    const user = await db.collection(collections.users).findOne({
      _id: new ObjectId(userId)
    });

    if (!user) return;

    const stats = user.stats || {};
    const achievements = user.achievements || [];
    const newAchievements = [];

    // Define achievement conditions
    const achievementChecks = [
      // Creation achievements
      { id: 'first_asset', name: 'First Steps', description: 'Created your first asset', condition: stats.assetsCreated >= 1 },
      { id: 'asset_creator_5', name: 'Creative Mind', description: 'Created 5 assets', condition: stats.assetsCreated >= 5 },
      { id: 'asset_creator_10', name: 'Master Creator', description: 'Created 10 assets', condition: stats.assetsCreated >= 10 },
      { id: 'asset_creator_25', name: 'Creative Genius', description: 'Created 25 assets', condition: stats.assetsCreated >= 25 },

      // Submission achievements
      { id: 'first_submission', name: 'Contributor', description: 'Submitted your first asset', condition: stats.assetsSubmitted >= 1 },
      { id: 'prolific_contributor', name: 'Prolific Contributor', description: 'Submitted 10 assets', condition: stats.assetsSubmitted >= 10 },

      // Voting achievements
      { id: 'first_vote', name: 'Community Member', description: 'Cast your first vote', condition: stats.votesCast >= 1 },
      { id: 'voter_25', name: 'Active Voter', description: 'Cast 25 votes', condition: stats.votesCast >= 25 },
      { id: 'voter_100', name: 'Democracy Champion', description: 'Cast 100 votes', condition: stats.votesCast >= 100 },

      // Suggestion achievements
      { id: 'first_suggestion', name: 'Helpful Hand', description: 'Made your first suggestion', condition: stats.suggestionsMade >= 1 },
      { id: 'suggestions_10', name: 'Collaborative Spirit', description: 'Made 10 suggestions', condition: stats.suggestionsMade >= 10 },

      // Activity achievements
      { id: 'login_streak_7', name: 'Week Warrior', description: 'Logged in 7 days in a row', condition: false }, // TODO: implement streak tracking
      { id: 'early_adopter', name: 'Early Adopter', description: 'Joined during early access', condition: user.createdAt && user.createdAt < new Date('2025-11-01') },

      // Character achievements
      { id: 'first_character', name: 'Character Builder', description: 'Created your first character', condition: stats.charactersCreated >= 1 },
      { id: 'character_master', name: 'Character Master', description: 'Created 5 characters', condition: stats.charactersCreated >= 5 },

      // Exploration achievements
      { id: 'explorer', name: 'Explorer', description: 'Visited 5 different zones', condition: stats.zonesVisited >= 5 },
      { id: 'galactic_tourist', name: 'Galactic Tourist', description: 'Visited 20 different zones', condition: stats.zonesVisited >= 20 },
    ];

    for (const check of achievementChecks) {
      if (check.condition && !achievements.find(a => a.id === check.id)) {
        const achievement = {
          id: check.id,
          name: check.name,
          description: check.description,
          unlockedAt: new Date()
        };
        newAchievements.push(achievement);
      }
    }

    if (newAchievements.length > 0) {
      await db.collection(collections.users).updateOne(
        { _id: new ObjectId(userId) },
        {
          $push: { achievements: { $each: newAchievements } }
        }
      );
    }

    return newAchievements;
  }

  /**
   * Get user analytics
   */
  static async getUserAnalytics(userId) {
    const db = getDb();

    // Get user with stats
    const user = await db.collection(collections.users).findOne({
      _id: new ObjectId(userId)
    });

    // Get recent actions
    const recentActions = await db.collection('userActions')
      .find({ userId: new ObjectId(userId) })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    // Get action breakdown
    const actionBreakdown = await db.collection('userActions').aggregate([
      { $match: { userId: new ObjectId(userId) } },
      {
        $group: {
          _id: '$actionType',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    return {
      user: {
        username: user.username,
        email: user.email,
        createdAt: user.createdAt,
        lastActive: user.lastActive,
        stats: user.stats || {},
        achievements: user.achievements || []
      },
      recentActions,
      actionBreakdown
    };
  }

  /**
   * Get platform-wide analytics
   */
  static async getPlatformAnalytics(days = 30) {
    const db = getDb();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Total users
    const totalUsers = await db.collection(collections.users).countDocuments();

    // Active users (in last 30 days)
    const activeUsers = await db.collection(collections.users).countDocuments({
      lastActive: { $gte: startDate }
    });

    // New users (in last 30 days)
    const newUsers = await db.collection(collections.users).countDocuments({
      createdAt: { $gte: startDate }
    });

    // Total actions in period
    const totalActions = await db.collection('userActions').countDocuments({
      timestamp: { $gte: startDate }
    });

    // Actions by type
    const actionsByType = await db.collection('userActions').aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: '$actionType',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    // Top users by activity
    const topUsers = await db.collection('userActions').aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: '$userId',
          actionCount: { $sum: 1 }
        }
      },
      { $sort: { actionCount: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: collections.users,
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          username: '$user.username',
          actionCount: 1
        }
      }
    ]).toArray();

    // Daily active users
    const dailyActiveUsers = await db.collection('userActions').aggregate([
      { $match: { timestamp: { $gte: startDate } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
          },
          users: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          date: '$_id.date',
          count: { $size: '$users' }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]).toArray();

    // Asset statistics
    const assetStats = await db.collection(collections.assets).aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Achievement distribution
    const achievementDistribution = await db.collection(collections.users).aggregate([
      { $match: { achievements: { $exists: true, $ne: [] } } },
      { $unwind: '$achievements' },
      {
        $group: {
          _id: '$achievements.id',
          name: { $first: '$achievements.name' },
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();

    return {
      overview: {
        totalUsers,
        activeUsers,
        newUsers,
        totalActions,
        averageActionsPerUser: activeUsers > 0 ? Math.round(totalActions / activeUsers) : 0
      },
      actionsByType,
      topUsers,
      dailyActiveUsers,
      assetStats,
      achievementDistribution
    };
  }

  /**
   * Get user retention data
   */
  static async getRetentionData() {
    const db = getDb();

    // Calculate retention by cohort
    const cohorts = await db.collection(collections.users).aggregate([
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m', date: '$createdAt' }
          },
          userCount: { $sum: 1 },
          users: { $push: '$_id' }
        }
      },
      { $sort: { '_id': -1 } },
      { $limit: 6 }
    ]).toArray();

    return cohorts;
  }
}

export default UserAnalytics;
