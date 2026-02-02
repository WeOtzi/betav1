# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-02
### Added
- **Unified Platform**: Integration of Quotation App and Artist Registry into a single unified web application.
- **Artist Features**:
  - Complete 12-step Artist Registration wizard.
  - Artist Dashboard (`/artist/dashboard`) for managing profile and requests.
  - Quotation Management (`/my-quotations`) to view and manage client requests.
  - Calendar View (`/calendar`) for scheduling.
  - Public Artist Profile (`/artist/profile`).
- **Client Features**:
  - Client Registration and Login (`/client/register`, `/client/login`).
  - Client Dashboard (`/client/dashboard`) to view quotation status.
  - Advanced Quotation Form (`/quotation`) with image reference upload.
- **AI Integration**:
  - **Gemini 3 Pro Image Generation**: Integrated Google Gemini API for generating tattoo concepts and reference images.
- **Cloud Integration**:
  - **Google Drive Sync**: Automatic folder creation and file upload to Google Drive for each new quotation (`/api/google-drive/*`).
  - **Supabase Backend**: Full integration for user authentication, database storage, and session logging.
- **Administration**:
  - Backoffice Panel (`/backoffice`) for platform administration.
  - Support Dashboard (`/support/dashboard`) for customer service agents.
  - System Backup & Restore**: New "Installer" module (`setup.js`) to generate and restore full system backups including database dumps and static files.
- **Infrastructure**:
  - Express.js server with JSON body parsing (50mb limit).
  - Session logging and analytics integration.
  - Client IP tracking.

### Changed
- Migrated to a unified repository structure.
- Enhanced API error handling for Google Drive and Gemini integrations.
- Optimized static file serving for the Single Page Application (SPA) structure.
