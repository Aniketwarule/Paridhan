// ============================================================
// Poshakh – Navigation (bottom tabs)
// ============================================================
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TodayScreen } from '../screens/TodayScreen';
import { NewOrderScreen } from '../screens/NewOrderScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { STRINGS } from '../strings';
import { COLORS, FONT, SPACE } from '../components/ui';
import { useAppContext } from '../context/AppContext';

const Tab = createBottomTabNavigator();

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function tabIcon(idle: IoniconName, active: IoniconName) {
  function TabIcon({ focused, color, size }: { focused: boolean; color: string; size: number }) {
    return <Ionicons name={focused ? active : idle} size={size} color={color} />;
  }
  return TabIcon;
}

export function AppNavigator() {
  // Re-render tab labels when the language changes.
  useAppContext();
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          // Keep the tab bar from riding up on top of the keyboard.
          tabBarHideOnKeyboard: true,
          tabBarActiveTintColor: COLORS.accent,
          tabBarInactiveTintColor: COLORS.textMuted,
          tabBarStyle: {
            backgroundColor: COLORS.bg,
            borderTopColor: COLORS.border,
            borderTopWidth: 1,
            height: 64,
            paddingBottom: SPACE.sm,
          },
          tabBarLabelStyle: {
            fontSize: FONT.sizeSmall,
            fontWeight: FONT.weightMedium,
          },
        }}
      >
        <Tab.Screen
          name="Today"
          component={TodayScreen}
          options={{
            tabBarLabel: STRINGS.tabToday,
            tabBarIcon: tabIcon('calendar-outline', 'calendar'),
          }}
        />
        <Tab.Screen
          name="NewOrder"
          component={NewOrderScreen}
          options={{
            tabBarLabel: STRINGS.tabNewOrder,
            tabBarIcon: tabIcon('add-circle-outline', 'add-circle'),
          }}
        />
        <Tab.Screen
          name="Orders"
          component={OrdersScreen}
          options={{
            tabBarLabel: STRINGS.tabOrders,
            tabBarIcon: tabIcon('cube-outline', 'cube'),
          }}
        />
        <Tab.Screen
          name="Reports"
          component={ReportsScreen}
          options={{
            tabBarLabel: STRINGS.tabReports,
            tabBarIcon: tabIcon('bar-chart-outline', 'bar-chart'),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarLabel: STRINGS.tabSettings,
            tabBarIcon: tabIcon('settings-outline', 'settings'),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
