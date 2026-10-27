'use strict';

const { CATEGORIES } = require('./enrich');

module.exports = function openapi(baseUrl) {
  const window = {
    type: 'object',
    properties: { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } },
  };
  const event = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Stable 16-hex-char id' },
      title: { type: 'string' },
      start: { type: 'string', format: 'date-time' },
      end: { type: 'string', format: 'date-time', nullable: true, description: 'End time when the source publishes one' },
      estimatedEnd: { type: 'string', format: 'date-time' },
      category: { type: 'string', enum: Object.keys(CATEGORIES) },
      categoryLabel: { type: 'string' },
      description: { type: 'string' },
      cancelled: { type: 'boolean' },
      postponed: { type: 'boolean' },
      confirmed: { type: 'boolean', description: 'False when the source marks the date/time as not final' },
      firstSeen: { type: 'string', format: 'date-time' },
      traffic: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['low', 'medium', 'high'] },
          expectedAttendance: { type: 'integer' },
          attendanceIsEstimate: { type: 'boolean' },
          arrivalWindow: window,
          departureWindow: window,
          advice: { type: 'string' },
        },
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' },
            start: { type: 'string', format: 'date-time' }, url: { type: 'string' },
          },
        },
      },
    },
  };
  const json = (schema) => ({ description: 'OK', content: { 'application/json': { schema } } });
  return {
    openapi: '3.0.3',
    info: {
      title: 'Yad Eliyahu Arena Events API',
      version: '1.0.0',
      description: 'Open, read-only API of upcoming events at Menora Mivtachim Arena (Yad Eliyahu, Tel Aviv), aggregated from public sources, with traffic estimates. No authentication. Rate limit: 120 requests/minute per IP.',
      license: { name: 'MIT' },
    },
    servers: [{ url: baseUrl || '/' }],
    paths: {
      '/api/events': {
        get: {
          summary: 'List events (upcoming by default)',
          parameters: [
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'category', in: 'query', schema: { type: 'string', enum: Object.keys(CATEGORIES) } },
            { name: 'include_past', in: 'query', schema: { type: 'boolean' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 } },
          ],
          responses: {
            200: json({ type: 'object', properties: { total: { type: 'integer' }, count: { type: 'integer' }, updatedAt: { type: 'string' }, events: { type: 'array', items: event } } }),
            400: { description: 'Invalid parameters' },
          },
        },
      },
      '/api/events/{id}': {
        get: {
          summary: 'Get one event',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: json(event), 404: { description: 'Not found' } },
        },
      },
      '/api/next': { get: { summary: 'The next (or currently running) event', responses: { 200: json({ type: 'object', properties: { event: event } }) } } },
      '/api/sources': { get: { summary: 'Data sources and the status of their last scrape', responses: { 200: { description: 'OK' } } } },
      '/api/categories': { get: { summary: 'Category ids and Hebrew labels', responses: { 200: { description: 'OK' } } } },
      '/calendar.ics': {
        get: {
          summary: 'iCalendar feed (subscribe from Google Calendar)',
          parameters: [
            { name: 'category', in: 'query', schema: { type: 'string', enum: Object.keys(CATEGORIES) } },
            { name: 'traffic', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'Also add arrival/departure traffic blocks' },
          ],
          responses: { 200: { description: 'text/calendar' } },
        },
      },
    },
  };
};
