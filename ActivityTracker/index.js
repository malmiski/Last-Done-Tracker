/**
 * @format
 */

import { AppRegistry, Platform } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

if (Platform.OS === 'android') {
AppRegistry.registerComponent('main', () => App);
}else{
AppRegistry.registerComponent(appName, () => App);
}