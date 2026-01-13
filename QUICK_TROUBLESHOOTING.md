# Quick Troubleshooting: Can't Find Climate Scheduler Card?

## Run This First! 🔍

1. Go to **Developer Tools** → **Services**
2. Find and select: `Climate Scheduler: Run Diagnostics`
3. Click **Call Service**
4. Read the recommendations in the response

## What You'll Learn

The diagnostics service will tell you:
- ✅ What version you're running
- ✅ If the card is properly registered
- ✅ If the card file is accessible
- ✅ Exactly what's wrong (if anything)
- ✅ How to fix it

## Common Fixes (Based on Diagnostics)

### "Everything looks good but I still don't see it"
The card is registered and working. This is usually a browser cache issue:
1. **Hard Refresh**: Press `Ctrl + Shift + R` (Windows/Linux) or `Cmd + Shift + R` (Mac)
2. **Clear Cache**: Press `Ctrl + Shift + Delete`, select "Cached images and files", click Clear
3. **Try Incognito**: Open a private/incognito window
4. **Different Browser**: Try Chrome, Firefox, or Edge

### "Card not registered"
The integration didn't register the card properly:
1. Go to **Settings** → **Devices & Services**
2. Find **Climate Scheduler**
3. Click the **⋮** menu → **Reload**
4. If that doesn't work, restart Home Assistant

### "YAML mode detected"
You're using Lovelace YAML configuration. You need to manually add:
```yaml
# In your lovelace configuration
resources:
  - url: /climate_scheduler/static/climate-scheduler-card.js
    type: module
```

### "Multiple card registrations"
You have duplicate entries (usually from HACS + bundled versions):
1. Go to **Settings** → **Dashboards** → **Resources**
2. Remove OLD entries for climate-scheduler-card
3. Keep only: `/climate_scheduler/static/climate-scheduler-card.js`

### "Card not accessible" or "HTTP error"
The card files might be missing:
1. Check that the integration installed correctly
2. Try reinstalling the integration
3. Restart Home Assistant

## Still Having Issues?

1. **Check Browser Console**: 
   - Press `F12`
   - Click **Console** tab
   - Look for errors (red text)
   - Take a screenshot

2. **Share Diagnostics**:
   - Copy the full response from `climate_scheduler.diagnostics`
   - Post it along with console errors in your support request

3. **GitHub Issues**: 
   - Go to: https://github.com/kneave/climate-scheduler/issues
   - Create a new issue with:
     - Diagnostics output
     - Browser console errors
     - Steps you've tried

## Pro Tips 💡

- Always run diagnostics after upgrading
- Clear browser cache after each integration update
- Use Incognito mode to test if it's a cache issue
- Check that you're looking in Lovelace, not in Devices & Services
