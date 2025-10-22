import BaseModel from './Base.js';

class ServiceMonitorLog extends BaseModel {
  static modelName = 'ServiceMonitorLog';
  static collectionName = 'service_monitor_logs';

  static modelFields = {
    serviceName: {
      type: 'String',
      required: true,
      label: 'Service Name'
    },
    status: {
      type: 'String',
      required: true,
      label: 'Status',
      enum: ['healthy', 'unhealthy', 'stopped', 'error']
    },
    running: {
      type: 'Boolean',
      required: true,
      label: 'Running'
    },
    port: {
      type: 'Number',
      required: false,
      label: 'Port'
    },
    domain: {
      type: 'String',
      required: false,
      label: 'Domain'
    },
    health: {
      type: 'Object',
      required: false,
      label: 'Health Check Data'
    },
    timestamp: {
      type: 'Date',
      required: true,
      default: () => new Date(),
      label: 'Timestamp'
    },
    details: {
      type: 'Object',
      required: false,
      label: 'Additional Details'
    }
  };

  constructor() {
    super(ServiceMonitorLog.collectionName);
    this.modelFields = ServiceMonitorLog.modelFields;
  }

  /**
   * Get recent logs for a specific service
   */
  async getServiceHistory(serviceName, limit = 100) {
    const collection = await this.getCollection();
    return await collection
      .find({ serviceName })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Get logs for all services within a time range
   */
  async getLogsInRange(startDate, endDate) {
    const collection = await this.getCollection();
    return await collection
      .find({
        timestamp: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      })
      .sort({ timestamp: -1 })
      .toArray();
  }

  /**
   * Get downtime statistics for a service
   */
  async getDowntimeStats(serviceName, days = 7) {
    const collection = await this.getCollection();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await collection
      .find({
        serviceName,
        timestamp: { $gte: startDate }
      })
      .sort({ timestamp: 1 })
      .toArray();

    let totalDowntime = 0;
    let incidents = 0;
    let currentDowntimeStart = null;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      if (log.status !== 'healthy' && !currentDowntimeStart) {
        currentDowntimeStart = log.timestamp;
        incidents++;
      } else if (log.status === 'healthy' && currentDowntimeStart) {
        totalDowntime += (log.timestamp - currentDowntimeStart);
        currentDowntimeStart = null;
      }
    }

    // If still down, count until now
    if (currentDowntimeStart) {
      totalDowntime += (new Date() - currentDowntimeStart);
    }

    const totalTime = Date.now() - startDate.getTime();
    const uptime = ((totalTime - totalDowntime) / totalTime) * 100;

    return {
      serviceName,
      days,
      totalDowntimeMs: totalDowntime,
      totalDowntimeHours: (totalDowntime / (1000 * 60 * 60)).toFixed(2),
      incidents,
      uptimePercentage: uptime.toFixed(2),
      period: { start: startDate, end: new Date() }
    };
  }

  /**
   * Clean up old logs (older than specified days)
   */
  async cleanupOldLogs(daysToKeep = 30) {
    const collection = await this.getCollection();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await collection.deleteMany({
      timestamp: { $lt: cutoffDate }
    });

    return {
      deleted: result.deletedCount,
      cutoffDate
    };
  }
}

export default ServiceMonitorLog;
