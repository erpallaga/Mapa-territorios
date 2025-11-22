# Mapa Territorios

A web application to visualize and manage territory assignments on an interactive map.

## Features

- **Interactive Map**: Visualize territories using KML/KMZ data.
- **Status Tracking**: Color-coded territories (Green for Free, Red for Assigned).
- **Dashboard**: View statistics on territory assignments.
- **Search**: Find territories by name or number.

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/erpallaga/Mapa-territorios.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally

Start the development server:

```bash
npm run dev
```

## Technologies

- React
- Vite
- Leaflet / React-Leaflet
- Tailwind CSS

## Deployment

This project is configured for static deployment on Vercel.

### How it works
The `build` script is configured to automatically process KML files into JSON before building the application. This means you don't need to manually run the conversion script.

### Steps to Deploy
1. Push your code to GitHub.
2. Import the project into Vercel.
3. Vercel will detect the Vite settings and deploy automatically.

### Updating the Map
To update the territories:
1. Add or replace KML files in the `kmlfiles` directory.
2. Commit and push the changes to GitHub.
3. Vercel will automatically rebuild and deploy the site with the new data.
