# Climate Scheduler Card Not Found

The most common problem folks seem to see with this is the card not being found after installation. **Good news!** The integration now includes an automated diagnostics service to help identify and fix these issues.

## 🔍 STEP 1: Run Automated Diagnostics (Recommended)

The fastest way to diagnose your issue:

1. Go to **Developer Tools** → **Services** in Home Assistant
2. Select service: **`Climate Scheduler: Run Diagnostics`**
3. Click **Call Service**
4. Read the response - it will tell you:
   - ✅ Your integration version
   - ✅ If the card is registered properly
   - ✅ If the card file is accessible
   - ✅ **Specific recommendations** for your situation

The diagnostics service automatically checks everything and provides tailored solutions. **Start here before trying manual troubleshooting!**

## 🛠️ Manual Troubleshooting Steps

If you prefer to troubleshoot manually or the diagnostics service indicates specific issues:

### Step 1: Verify Integration is Installed
Visit the [integrations page](http://homeassistant.local:8123/config/integrations/dashboard) and confirm **Climate Scheduler** is listed. If not:
- Click **Add Integration** and search for Climate Scheduler
- After adding, **reload the integration** or restart Home Assistant

### Step 2: Check Card Registration
Visit the [Lovelace resources page](http://homeassistant.local:8123/config/lovelace/resources) and look for:
```
/climate_scheduler/static/climate-scheduler-card.js
```

**If it's NOT in the list:**
- Reload the Climate Scheduler integration
- If still missing, restart Home Assistant
- Run the diagnostics service to see if you're in YAML mode

**If you see MULTIPLE entries** for the card:
- Remove old entries (especially any with `/hacsfiles/` or `/local/community/`)
- Keep only the `/climate_scheduler/static/` version
- Or use the `reregister_card` service to clean them up

### Step 3: Verify Card File is Accessible
Visit [this link](http://homeassistant.local:8123/climate_scheduler/static/climate-scheduler-card.js) - you should see a page full of JavaScript code.

**If you get a 404 error:**
- The card files may not be installed correctly
- Try reinstalling the integration
- Check that the `custom_components/climate_scheduler/frontend/` folder exists

### Step 4: Clear Browser Cache
Home Assistant aggressively caches resources. **This is the most common cause** when everything else looks correct:

1. **Hard Refresh**: Press `Ctrl + Shift + R` (Windows/Linux) or `Cmd + Shift + R` (Mac)
2. **Full Cache Clear**: 
   - Press `F12` to open Developer Tools
   - Right-click the refresh button
   - Select **"Empty Cache and Hard Reload"** (Chrome) or **"Clear Cache and Refresh"**
3. **Try Incognito/Private Mode**: Open a private window to test without cache
4. **Different Browser**: Try Chrome, Firefox, or Edge

### Step 5: Restart Home Assistant
Sometimes Home Assistant needs a full restart to properly serve the card. After restarting:
- Wait 2-3 minutes for everything to load
- Clear your browser cache again
- Try adding the card

## 📋 Special Cases

### YAML Mode Users
If you're using Lovelace in YAML mode (the diagnostics service will tell you, or you'll receive a persistent notification), the card **cannot be auto-registered** and you **must** manually add it to your configuration.

**How to identify YAML mode:**
- You see a persistent notification: "Climate Scheduler: Manual Card Registration Required"
- The diagnostics service reports "Lovelace YAML mode detected"
- Your `configuration.yaml` has `lovelace: mode: yaml`

**Method 1: In configuration.yaml**

If your Lovelace configuration is in `configuration.yaml`:

```yaml
lovelace:
  mode: yaml
  resources:
    - url: /climate_scheduler/static/climate-scheduler-card.js
      type: module
```

**Method 2: Separate resources file**

If you have a separate resources file (e.g., `lovelace/resources.yaml`):

```yaml
# In configuration.yaml
lovelace:
  mode: yaml
  resources: !include lovelace/resources.yaml

# In lovelace/resources.yaml
- url: /climate_scheduler/static/climate-scheduler-card.js
  type: module
```

**Method 3: Dashboard-specific YAML mode**

If you have per-dashboard YAML mode, add it in the specific dashboard's configuration file under its resources section.

**After adding:**
1. **Save the configuration file**
2. **Restart Home Assistant** (full restart required for YAML changes)
3. **Hard refresh your browser** (`Ctrl+F5` or `Cmd+Shift+R`)
4. The persistent notification will automatically dismiss on next startup

**Note:** The version parameter (`?v=...`) is optional but can be added for cache busting. The notification shows the current version to use.

### After Upgrading
After upgrading the integration:
1. Always clear your browser cache (the version may be cached)
2. Do a hard refresh (`Ctrl + Shift + R`)
3. If issues persist, reload the integration from the Integrations page

### Migrating from HACS to Built-in Card
If you previously installed the card separately via HACS:
1. The integration now bundles the card - no separate installation needed
2. Remove the old HACS card installation
3. Remove old resource entries from the Lovelace resources page
4. Reload the Climate Scheduler integration
5. The card will auto-register at `/climate_scheduler/static/climate-scheduler-card.js`

## 🐛 Still Not Working?

If you've tried everything above:

1. **Run the diagnostics service** (if you haven't already) and save the output
2. **Check browser console for errors**:
   - Press `F12`
   - Click the **Console** tab
   - Look for red error messages
   - Take a screenshot
3. **Create a GitHub issue** with:
   - The full diagnostics service output
   - Browser console errors (screenshot)
   - Steps you've already tried
   - Your Home Assistant version
   - Your browser and version

**GitHub Issues**: https://github.com/kneave/climate-scheduler/issues

## 💡 Pro Tips

- Always run diagnostics first - it saves time!
- Clear browser cache after every integration update
- Use incognito mode to quickly test if it's a cache issue
- The card appears in the "Add Card" menu, not in Settings → Devices & Services
- Check you're looking in **Lovelace dashboards**, not the device page