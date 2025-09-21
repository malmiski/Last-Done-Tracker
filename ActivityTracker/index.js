/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

if (Platform.OS === 'android') {
    AppRegistry.registerComponent('main', () => App);
} else if (Platform.OS === 'web') {
    AppRegistry.registerComponent('main', () => App);
    // Assuming you have an HTML file with a div like <div id="root"></div>
    AppRegistry.runApplication('main', {
        rootTag: document.getElementById('root'),
    });
} else {
    AppRegistry.registerComponent(appName, () => App);
}