export const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
};

let counter = 0;

export const uniqueName = (label: string) =>
  `nest-${label}-${process.pid}-${Date.now().toString(36)}-${counter++}`;
