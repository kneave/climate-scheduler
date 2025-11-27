# Climate Scheduler for Home Assistant

A custom Home Assistant integration that provides intelligent 24-hour scheduling for climate entities (thermostats, HVAC systems, and heaters) with an intuitive touch-friendly graph interface.

## Future Features
- Scheduling for switching on/off switches (boilers, pumps, fans, etc)
- Enchanced scheduling
  - 7 Day scheduling
  - weekend/weekday
  - holiday mode with timer
- Sync to thermostats
  - If a room thermostat is in use stat supports standalone scheduling it should sync with this add-on in case of outages

## Features

- 📱 **Mobile-Optimized Interface** - Touch-friendly graph editor works seamlessly on phones, tablets, and desktop browsers
- ⏰ **15-Minute Precision** - Schedule temperature changes at 15-minute intervals throughout the day
- 📊 **Visual Graph Editor** - Interactive SVG graph with draggable nodes for easy schedule creation
- 📈 **Temperature History** - View actual room temperature overlaid on your schedule for the current day
- 🏠 **Multi-Zone Support** - Manage schedules for unlimited climate entities independently
- 🔄 **Automatic Execution** - Schedules run automatically, updating thermostats throughout the day
- 💾 **Persistent Storage** - Schedules saved and restored across Home Assistant restarts
- ⚙️ **Advanced Climate Controls** - Set HVAC mode, fan mode, swing mode, and preset modes per schedule node
- 🌡️ **Unit Support** - Automatically detects and uses your Home Assistant temperature unit (°C or °F)
- 🎯 **Precision Control** - Enable/disable schedules individually without losing configuration

## Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Click on "Integrations"
3. Click the three dots in the top right corner
4. Select "Custom repositories"
5. Enter the repository URL: `https://github.com/kneave/climate-scheduler`
6. Select category: "Integration"
7. Click "Add"
8. Search for "Climate Scheduler" and install
9. Restart Home Assistant

### Manual Installation

1. Download the latest release from [GitHub](https://github.com/kneave/climate-scheduler/releases)
2. Copy the `custom_components/climate_scheduler` folder to your `config/custom_components/` directory
3. Restart Home Assistant
4. Add `climate_scheduler:` to your `configuration.yaml`
5. Restart Home Assistant again

## Usage

1. After installation, add `climate_scheduler:` to your `configuration.yaml`
2. Restart Home Assistant
3. Click on "Climate Scheduler" in the sidebar
4. Check the climate entities you want to schedule (they move to "Active")
5. Click on an entity to view and edit its schedule graph
6. **Tap** on the graph to add temperature nodes at specific times
7. **Drag** nodes to adjust time (horizontally) or temperature (vertically)
8. **Tap a node** to edit advanced settings (HVAC mode, fan mode, swing mode, preset)
9. Changes auto-save - no save button needed!
10. Use the **three-dot menu** to refresh entities or sync all thermostats
11. Toggle **Enabled** to activate/deactivate a schedule without losing it
12. Use **Clear Schedule** to completely remove a schedule (with confirmation)

## Default Schedule

When you first enable a climate entity, it starts with a simple default:
- **00:00** - 18°C (constant temperature)

You can customize this by:
- Tapping the graph to add nodes at different times
- Dragging nodes to change time or temperature
- Tapping nodes to set HVAC/fan/swing/preset modes
- Removing nodes by tapping them and clicking "Delete Node"

## Graph Features

- **Blue line**: Actual room temperature (current day history)
- **Orange line**: Your scheduled target temperature
- **Green dashed line**: Current time indicator
- **Circles**: Schedule nodes (tap to edit, drag to move)

## Requirements

- Home Assistant Core 2024.1.0 or later
- At least one climate entity configured in Home Assistant

## Support

For issues, feature requests, or questions:
- [GitHub Issues](https://github.com/kneave/climate-scheduler/issues)
- [Discussions](https://github.com/kneave/climate-scheduler/discussions)

## License

MIT License - see [LICENSE](LICENSE) file for details

## Development & AI Attribution

This project was developed with the assistance of AI language models, specifically Claude (Anthropic) through the GitHub Copilot Chat interface in Visual Studio Code. The AI assisted with:

- Architecture design and implementation
- Code generation for both backend (Python) and frontend (JavaScript/HTML/CSS)
- Integration with Home Assistant APIs and WebSocket communication
- SVG graph interaction and touch-friendly interface design
- Documentation and development workflows

### Key References & Resources

The following resources were consulted during development:

**Home Assistant Development:**
- [Home Assistant Developer Documentation](https://developers.home-assistant.io/)
- [Home Assistant Architecture](https://developers.home-assistant.io/docs/architecture_index)
- [Creating a Custom Integration](https://developers.home-assistant.io/docs/creating_integration_manifest)
- [Frontend Development](https://developers.home-assistant.io/docs/frontend/)

**Home Assistant APIs:**
- [WebSocket API](https://developers.home-assistant.io/docs/api/websocket)
- [REST API](https://developers.home-assistant.io/docs/api/rest)
- [Climate Entity Documentation](https://www.home-assistant.io/integrations/climate/)
- [DataUpdateCoordinator](https://developers.home-assistant.io/docs/integration_fetching_data)

**Web Technologies:**
- [MDN Web Docs - SVG](https://developer.mozilla.org/en-US/docs/Web/SVG)
- [MDN Web Docs - Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events)
- [MDN Web Docs - Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)

**Python Libraries:**
- Home Assistant Core framework and utilities
- aiohttp for async HTTP operations
- JSON storage via Home Assistant Store

### Disclaimer

While AI models provided significant assistance in code generation and problem-solving, this project is provided "as-is" without warranty of any kind. The code has been developed and tested on a best-effort basis. Users should review the code and test thoroughly in their own environments before relying on it for critical heating/cooling control. Use at your own risk.

