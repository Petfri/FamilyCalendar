# Family Calendar & Shopping List

A family-shared calendar and shopping list application built with vanilla JavaScript and Supabase.

## Features

### 📅 Calendar
- Weekly calendar view with customizable time range
- Add, edit, and delete appointments
- Assign appointments to family members
- Recurring appointments (weekly/monthly)
- Color-coded by family member
- Drag-and-drop to reschedule
- Swipe navigation on mobile

### 🛒 Shopping Lists
- Multiple shopping lists (stores)
- Drag-and-drop to reorder items
- Add section headers to organize items
- Check off items (automatically move to bottom)
- Real-time sync across all devices

### 👨‍👩‍👧‍👦 Family Sharing
- Multi-family support
- Invite family members with a code
- Each family has independent data
- Real-time updates for all family members

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Backend**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth (Google OAuth)
- **Real-time**: Supabase Realtime (with polling fallback)
- **Drag & Drop**: Sortable.js

## Setup

1. Clone this repository
2. Open `index.html` in a web browser
3. Sign in with Google
4. Create or join a family

## Database Schema

The app uses the following Supabase tables:
- `families` - Family information and settings
- `family_members` - Family members with colors
- `appointments` - Calendar appointments
- `store_types` - Shopping list categories
- `grocery_items` - Shopping list items

## Configuration

Update the Supabase credentials in `app.js`:
```javascript
var SUPABASE_URL = 'your-project-url';
var SUPABASE_KEY = 'your-anon-key';
```

## Features in Detail

### Persistent Ordering
All items maintain their order across sessions:
- Family members in sidebar
- Shopping lists in sidebar
- Items within each list
- Checked items automatically move to bottom of their section

### Real-time Sync
Changes sync instantly across all devices using Supabase Realtime. If Realtime is unavailable, the app falls back to polling every 10 seconds.

### Customizable Time Range
Each family can set their own calendar start and end hours in the settings.

## License

MIT
