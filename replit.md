# Replit.md

## Overview

This is a Telegram bot for NEMO Moscow, a construction and renovation company. The bot provides AI-powered construction inspection and interior design services through two specialized AI agents. Users can upload photos to receive professional analysis from an AI inspector for construction defects or an AI designer for interior design suggestions. The system includes subscription verification, usage limits, payment processing, referral systems, and a comprehensive admin dashboard for managing the bot.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Library**: shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Admin Interface**: Single-page dashboard with tabbed navigation for managing bot operations

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Telegram Integration**: Telegraf library for bot interactions and webhook handling
- **AI Services**: OpenAI GPT-5 integration for image analysis and text generation
- **Background Jobs**: Node-cron for scheduled tasks (weekly limit resets, subscription checks)
- **Session Management**: Express sessions with PostgreSQL store
- **File Structure**: Monorepo with shared schema and types between client/server

### Database Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Database Provider**: Neon Database (serverless PostgreSQL)
- **Schema Design**: Comprehensive user tracking, AI request logging, payment records, broadcast management, and referral system
- **Data Management**: Automated cleanup jobs and weekly usage limit resets

### Authentication & Authorization
- **Bot Access**: Telegram user authentication through bot interactions
- **Subscription Control**: Channel membership verification for AI agent access
- **Admin Access**: No explicit admin authentication system (admin panel is open)
- **Usage Limits**: Per-user weekly request limits with premium upgrade options

### AI Agent System
- **Inspector Agent**: Analyzes construction photos for defects and quality issues
- **Designer Agent**: Provides interior design suggestions based on uploaded images and user preferences
- **Image Processing**: OpenAI Vision API for photo analysis
- **Usage Tracking**: Request counting, processing time monitoring, and status tracking

### Payment System
- **Provider**: Telegram Payments integration
- **Packages**: Predefined request packages for users to purchase additional AI agent uses
- **Currency**: Russian Rubles (RUB)
- **Tracking**: Complete payment history and status monitoring

## Two-Bot System Setup

The system supports **2 separate bot environments** to avoid conflicts:

### Bot Token Configuration
- **Preview (Replit Workspace)**: `BOT_TOKEN_DEV` - New bot for development/testing
- **Deploy (Replit Deploy)**: `BOT_TOKEN` - Existing bot for live deployment

### Environment Detection
- **Preview**: When running in Replit Workspace (default development environment)
- **Deploy**: When `REPLIT_DEPLOYMENT=true` or `NODE_ENV=production`

### Bot Management
- Set `DISABLE_BOT=true` to disable bot in any environment
- Each environment automatically selects appropriate token
- Clear logging shows which bot/token is being used

## External Dependencies

- **Neon Database**: Serverless PostgreSQL hosting for data persistence
- **OpenAI API**: GPT-5 model for AI analysis and text generation capabilities
- **laozhang.ai API**: Cost-effective AI image generation and editing service
- **Telegram Bot API**: Core bot functionality, webhook handling, and payment processing (3 separate bots)
- **Replit Services**: Development environment with custom Vite plugins and error handling
- **Node.js Libraries**: Express, Telegraf, Drizzle ORM, node-cron for core functionality
- **Frontend Libraries**: React ecosystem including TanStack Query, Radix UI, Tailwind CSS, and Wouter