# Climate Scheduler Card Not Found

The most common problem folks seem to see with this is the card not being found after installation, it's a bit hit and miss as to when this occurs and has been a pain to try and fix. 

Steps to troubleshoot:
1. Visit the [integrations](http://homeassistant.local:8123/config/integrations/dashboard) page and confirm Climate Scheduler is listed, if not click Add Integrations to do so. You may need to reboot at this point.
2. If the Climate Scheduler card still isn't listed when trying to add a card to a dashboard, visit [this](http://homeassistant.local:8123/config/lovelace/resources) url and confirm that something similar to below is on the list.
`/climate_scheduler/static/climate-scheduler-card.js`
3. If it is in the list then visit [this](http://homeassistant.local:8123/climate_scheduler/static/climate-scheduler-card.js) link, you should see a page full of code. 
4. Home Assistant has a knack for preventing UI refreshes so it's worth trying to nuke your browser cache. Press F12 to open the Dev Tools in your browser, right click on the refresh button, and choose "clear cache and refresh". 
5. If the above hasn't helped try another reboot, sometimes this is needed for Home Assistant to properly serve the card.

If all of these prove true it *should* be working, if not please raise an issue for me to investigate.