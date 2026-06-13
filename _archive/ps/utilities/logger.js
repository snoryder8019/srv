/**
 * Custom logger utility
 */
import chalk from 'chalk';

export const log = {
  info: (message) => {
    console.log(chalk.blue('[INFO]'), message);
  },

  success: (message) => {
    console.log(chalk.green('[SUCCESS]'), message);
  },

  warning: (message) => {
    console.log(chalk.yellow('[WARNING]'), message);
  },

  error: (message, error) => {
    console.log(chalk.red('[ERROR]'), message);
    if (error) {
      console.error(error);
    }
  },

  debug: (message, data) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(chalk.magenta('[DEBUG]'), message);
      if (data) {
        console.log(data);
      }
    }
  }
};

export default log;
