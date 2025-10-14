import ModelHelper from "./helpers/models.js";

/**
 * Comment Model
 * Stores user comments on news articles
 */
export default class Comment extends ModelHelper {
  constructor(commentData) {
    super('comments');
    this.modelFields = {
      articleUrl: { type: 'text', value: null, editable: true },
      articleTitle: { type: 'text', value: null, editable: true },
      articleSource: { type: 'text', value: null, editable: true },
      userId: { type: 'text', value: null, editable: true },
      userEmail: { type: 'text', value: null, editable: true },
      userName: { type: 'text', value: null, editable: true },
      commentText: { type: 'text', value: null, editable: true },
      createdAt: { type: 'date', value: null, editable: false },
      likes: { type: 'number', value: 0, editable: true }
    }
  }
}
